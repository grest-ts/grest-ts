import type {RuntimeRunner} from "./RuntimeRunner";
import {Worker} from "worker_threads";
import {GGLog} from "@grest-ts/logger";
import {GGTestEnvConfig} from "../GGTestRuntime";

export class WorkerRunner implements RuntimeRunner {
    private worker?: Worker;
    private readonly config: GGTestEnvConfig
    private started = false;
    private onUnexpectedExit?: (code: number) => void;

    private static workerLoaderPath: string | undefined;

    // Workers whose runtime was released, by runtime module + class: their module graph is loaded, so the next start
    // of the same runtime only constructs and starts a fresh instance.
    private static readonly parked = new Map<string, ParkedWorker[]>();
    private static parkings = 0;
    private static reuse = false;

    /** Keep a stopped runtime's worker for the next start of the same runtime (set by testkit-vitest under `isolate: false`). */
    public static setReuse(reuse: boolean): void {
        this.reuse = reuse;
    }

    public static parkedMark(): number {
        return WorkerRunner.parkings;
    }

    /** Ends the workers parked before `mark` (from parkedMark()) that no runtime took since, so a worker holds only what
     *  its next files reuse. */
    public static terminateUnused(mark: number): void {
        for (const workers of WorkerRunner.parked.values()) {
            for (const entry of workers.filter(p => p.parkedAt < mark)) {
                WorkerRunner.unpark(workers, entry);
                void entry.worker.terminate();
            }
        }
    }

    private static unpark(workers: ParkedWorker[], entry: ParkedWorker): void {
        const i = workers.indexOf(entry);
        if (i >= 0) workers.splice(i, 1);
        entry.worker.off('exit', entry.onExit);
    }

    /**
     * Set the path to the worker-loader.mjs file.
     * Called by @grest-ts/testkit-vitest to inject the path.
     */
    public static setWorkerLoaderPath(path: string): void {
        this.workerLoaderPath = path;
    }

    constructor(config: GGTestEnvConfig) {
        this.config = config
    }

    private get poolKey(): string {
        return this.config.executablePath + "#" + this.config.className;
    }

    async start(): Promise<void> {
        GGLog.debug(this, 'Starting worker: ' + this.config.executablePath);

        if (!WorkerRunner.workerLoaderPath) {
            throw new Error(
                "Worker loader path not set!\n" +
                "Make sure to import '@grest-ts/testkit-vitest' in your vitest setup."
            );
        }

        const entry = WorkerRunner.parked.get(this.poolKey)?.pop();
        if (entry) entry.worker.off('exit', entry.onExit);
        const parked = entry?.worker;
        const worker = parked ?? this.spawn(WorkerRunner.workerLoaderPath);
        this.worker = worker;
        if (parked) {
            parked.ref();
            parked.postMessage({type: 'start', config: this.config, env: {...process.env}});
        }

        // Wait for worker to signal ready
        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    // CRITICAL: Terminate worker on timeout to prevent leak
                    worker.terminate();
                    reject(new Error('Worker did not start within 30 seconds'));
                }, 30000);

                const messageHandler = (msg: any) => {
                    if (msg.type === 'ready') {
                        cleanup();
                        this.started = true;
                        // Monitor for unexpected worker exit after successful startup
                        this.onUnexpectedExit = (code) => GGLog.error(this, `Worker exited unexpectedly with code ${code}`);
                        worker.on('exit', this.onUnexpectedExit);
                        GGLog.debug(this, 'Worker ready');
                        resolve();
                    } else if (msg.type === 'error') {
                        cleanup();
                        worker.terminate();
                        reject(new Error(`Runtime worker startup failed! ${msg.error}`));
                    }
                };
                const errorHandler = (err: Error) => {
                    cleanup();
                    worker.terminate();
                    reject(err);
                };
                const exitHandler = (code: number) => {
                    if (code !== 0) {
                        cleanup();
                        reject(new Error(`Worker exited with code ${code}`));
                    }
                };
                const cleanup = () => {
                    clearTimeout(timeout);
                    worker.off('message', messageHandler);
                    worker.off('error', errorHandler);
                    worker.off('exit', exitHandler);
                };

                worker.on('message', messageHandler);
                worker.once('error', errorHandler);
                worker.once('exit', exitHandler);
            });
        } catch (error) {
            // Ensure worker is cleaned up on any error
            this.worker = undefined;
            throw error;
        }
    }

    private spawn(workerLoaderPath: string): Worker {
        const worker = new Worker(workerLoaderPath, {
            workerData: this.config,
            stdout: true,
            stderr: true
        });

        // Forward worker stdout to parent's console using console.log
        // so vitest can capture and sequence it properly with test output
        worker.stdout.on('data', (data: Buffer) => {
            for (const line of data.toString().split('\n')) {
                if (line) console.log(line);
            }
        });

        // Forward worker stderr to parent's console
        worker.stderr.on('data', (data: Buffer) => {
            for (const line of data.toString().split('\n')) {
                if (line) console.error(line);
            }
        });
        return worker;
    }

    async stopRuntime(): Promise<void> {
        if (!this.worker) {
            return;
        }

        GGLog.debug(this, 'Stopping runtime in worker...');

        return new Promise<void>((resolve, reject) => {
            if (!this.worker) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                GGLog.error(this, 'Timeout waiting for runtime to stop');
                reject(new Error('Timeout waiting for runtime to stop'));
            }, 5000);

            const messageHandler = (msg: any) => {
                if (msg.type === 'runtimeStopped') {
                    clearTimeout(timeout);
                    this.worker?.off('message', messageHandler);
                    GGLog.debug(this, 'Runtime stopped in worker');
                    resolve();
                }
            };

            this.worker.on('message', messageHandler);
            this.worker.postMessage({type: 'stopRuntime'});
        });
    }

    async shutdown(): Promise<void> {
        const worker = this.worker;
        if (!worker) {
            return;
        }
        this.worker = undefined;
        if (this.onUnexpectedExit) worker.off('exit', this.onUnexpectedExit);

        if (this.started && WorkerRunner.reuse && await this.release(worker)) {
            worker.unref();
            const parked = WorkerRunner.parked.get(this.poolKey) ?? [];
            const entry: ParkedWorker = {worker, parkedAt: WorkerRunner.parkings++, onExit: () => WorkerRunner.unpark(parked, entry)};
            worker.once('exit', entry.onExit);
            parked.push(entry);
            WorkerRunner.parked.set(this.poolKey, parked);
            GGLog.debug(this, 'Worker parked for reuse');
            return;
        }

        GGLog.debug(this, 'Shutting down worker...');

        return new Promise<void>((resolve) => {
            worker.once('exit', () => {
                clearTimeout(forceTerminateTimeout);
                GGLog.debug(this, 'Worker shut down');
                resolve();
            });

            // Send shutdown message for graceful shutdown
            worker.postMessage({type: 'shutdown'});

            // Force terminate after 2 seconds if graceful shutdown doesn't work
            const forceTerminateTimeout = setTimeout(() => {
                GGLog.debug(this, 'Force terminating worker (timeout)');
                worker.terminate();
                resolve();
            }, 2000);
        });
    }

    private release(worker: Worker): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
                worker.off('message', messageHandler);
                resolve(false);
            }, 2000);
            const messageHandler = (msg: any) => {
                if (msg.type === 'released') {
                    clearTimeout(timeout);
                    worker.off('message', messageHandler);
                    resolve(true);
                }
            };
            worker.on('message', messageHandler);
            worker.postMessage({type: 'release'});
        });
    }
}

interface ParkedWorker {
    worker: Worker;
    parkedAt: number;
    onExit: () => void;
}
