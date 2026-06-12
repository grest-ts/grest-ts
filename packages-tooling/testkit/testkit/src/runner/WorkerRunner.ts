import type {RuntimeRunner} from "./RuntimeRunner";
import {Worker} from "worker_threads";
import {GGLog} from "@grest-ts/logger";
import {GGTestEnvConfig} from "../GGTestRuntime";

export class WorkerRunner implements RuntimeRunner {
    private worker?: Worker;
    private readonly config: GGTestEnvConfig

    private static workerLoaderPath: string | undefined;

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

    async start(): Promise<void> {
        GGLog.debug(this, 'Starting worker: ' + this.config.executablePath);

        if (!WorkerRunner.workerLoaderPath) {
            throw new Error(
                "Worker loader path not set!\n" +
                "Make sure to import '@grest-ts/testkit-vitest' in your vitest setup."
            );
        }
        const workerLoaderPath = WorkerRunner.workerLoaderPath;

        this.worker = new Worker(workerLoaderPath, {
            workerData: this.config,
            stdout: true,
            stderr: true
        });

        // Forward worker stdout to parent's console using console.log
        // so vitest can capture and sequence it properly with test output
        this.worker.stdout.on('data', (data: Buffer) => {
            const str = data.toString();
            // Split by newlines and log each line (trimming trailing newline)
            const lines = str.split('\n');
            for (const line of lines) {
                if (line) console.log(line);
            }
        });

        // Forward worker stderr to parent's console
        this.worker.stderr.on('data', (data: Buffer) => {
            const str = data.toString();
            const lines = str.split('\n');
            for (const line of lines) {
                if (line) console.error(line);
            }
        });

        // Wait for worker to signal ready
        try {
            await new Promise<void>((resolve, reject) => {
                if (!this.worker) {
                    reject(new Error('Worker failed to start'));
                    return;
                }

                const timeout = setTimeout(() => {
                    // CRITICAL: Terminate worker on timeout to prevent leak
                    this.worker?.terminate();
                    reject(new Error('Worker did not start within 30 seconds'));
                }, 30000);

                const messageHandler = (msg: any) => {
                    if (msg.type === 'ready') {
                        clearTimeout(timeout);
                        this.worker?.off('message', messageHandler);
                        // Monitor for unexpected worker exit after successful startup
                        this.worker?.on('exit', (code) => {
                            GGLog.error(this, `Worker exited unexpectedly with code ${code}`);
                        });
                        GGLog.debug(this, 'Worker ready');
                        resolve();
                    } else if (msg.type === 'error') {
                        clearTimeout(timeout);
                        this.worker?.off('message', messageHandler);
                        this.worker?.terminate();
                        reject(new Error(`Runtime worker startup failed! ${msg.error}`));
                    }
                };

                this.worker.on('message', messageHandler);

                this.worker.once('error', (err) => {
                    clearTimeout(timeout);
                    this.worker?.terminate();
                    reject(err);
                });

                this.worker.once('exit', (code) => {
                    if (code !== 0) {
                        clearTimeout(timeout);
                        reject(new Error(`Worker exited with code ${code}`));
                    }
                });
            });
        } catch (error) {
            // Ensure worker is cleaned up on any error
            this.worker = undefined;
            throw error;
        }
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
        if (!this.worker) {
            return;
        }

        GGLog.debug(this, 'Shutting down worker...');

        return new Promise<void>((resolve) => {
            if (!this.worker) {
                resolve();
                return;
            }

            this.worker.once('exit', () => {
                clearTimeout(forceTerminateTimeout);
                this.worker = undefined;
                GGLog.debug(this, 'Worker shut down');
                resolve();
            });

            // Send shutdown message for graceful shutdown
            this.worker.postMessage({type: 'shutdown'});

            // Force terminate after 2 seconds if graceful shutdown doesn't work
            const forceTerminateTimeout = setTimeout(() => {
                if (this.worker) {
                    GGLog.debug(this, 'Force terminating worker (timeout)');
                    this.worker.terminate();
                    this.worker = undefined;
                    resolve();
                }
            }, 2000);
        });
    }
}
