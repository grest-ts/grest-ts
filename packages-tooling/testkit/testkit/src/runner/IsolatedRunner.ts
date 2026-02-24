import type {RuntimeRunner} from "./RuntimeRunner";
import {type ChildProcess, spawn} from "child_process";
import {GGLog} from "@grest-ts/logger";
import {GGTestEnvConfig} from "../GGTestRuntime";

const PROCESS_READY = "IsolatedRunner:READY"
const GG_ISOLATED_CONFIG = "GG_ISOLATED_CONFIG";

export class IsolatedRunner implements RuntimeRunner {
    private process?: ChildProcess;

    private static isolatedLoaderPath: string | undefined;

    /**
     * Set the path to the isolated-loader.mjs file.
     * Called by @grest-ts/testkit-vitest to inject the path.
     */
    public static setIsolatedLoaderPath(path: string): void {
        this.isolatedLoaderPath = path;
    }

    constructor(private config: GGTestEnvConfig) {
    }

    async start(): Promise<void> {
        if (!IsolatedRunner.isolatedLoaderPath) {
            throw new Error(
                "Isolated loader path not set!\n" +
                "Make sure to import '@grest-ts/testkit-vitest' in your vitest setup."
            );
        }

        GGLog.debug(this, 'Starting isolated process for: ' + this.config.executablePath);

        this.process = spawn('npx', ['tsx', IsolatedRunner.isolatedLoaderPath!, this.config.executablePath], {
            env: {
                ...process.env,
                [GG_ISOLATED_CONFIG]: JSON.stringify(this.config)
            },
            stdio: ['pipe', 'pipe', 'pipe'], // pipe all streams so we can forward them properly
            shell: true // Required for Windows to find npx
        });

        // Forward stderr to console.error so vitest can capture and sequence it
        this.process.stderr?.setEncoding('utf8');
        this.process.stderr?.on('data', (data: string) => {
            const lines = data.split('\n');
            for (const line of lines) {
                if (line) console.error(line);
            }
        });

        // Wait for process to signal ready via stdout
        await new Promise<void>((resolve, reject) => {
            if (!this.process) {
                reject(new Error('Process failed to start'));
                return;
            }

            const timeout = setTimeout(() => {
                this.process?.kill('SIGKILL');
                reject(new Error(`Process did not send READY signal within 10 seconds`));
            }, 10000);

            // Watch stdout for READY signal and forward all output using console.log
            // so vitest can capture and sequence it properly with test output
            this.process.stdout?.setEncoding('utf8');
            let ready = false;
            const onData = (data: string) => {
                const lines = data.split('\n');
                for (const line of lines) {
                    if (line) console.log(line);
                }
                if (!ready && data.includes(PROCESS_READY)) {
                    clearTimeout(timeout);
                    GGLog.debug(this, 'Process ready');
                    ready = true;
                    resolve();
                }
            };
            this.process.stdout?.on('data', onData);

            this.process.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            this.process.once('exit', (code) => {
                if (code !== 0 && code !== null) {
                    clearTimeout(timeout);
                    reject(new Error(`Process exited with code ${code} before sending READY signal`));
                }
            });
        });
    }

    async stopRuntime(): Promise<void> {
        if (!this.process) {
            return;
        }

        GGLog.debug(this, 'Stopping runtime in process...');

        const RUNTIME_STOPPED = 'IsolatedRunner:RUNTIME_STOPPED';

        return new Promise<void>((resolve, reject) => {
            if (!this.process) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                GGLog.error(this, 'Timeout waiting for runtime to stop');
                reject(new Error('Timeout waiting for runtime to stop'));
            }, 5000);

            // Listen for RUNTIME_STOPPED signal in stdout
            const onData = (data: string) => {
                if (data.includes(RUNTIME_STOPPED)) {
                    clearTimeout(timeout);
                    this.process?.stdout?.off('data', onData);
                    GGLog.debug(this, 'Runtime stopped in process');
                    resolve();
                }
            };
            this.process.stdout?.on('data', onData);

            // Send stop runtime command via stdin
            try {
                this.process.stdin?.write('STOP_RUNTIME\n');
                GGLog.debug(this, 'Sent stop runtime command via stdin');
            } catch (error) {
                clearTimeout(timeout);
                GGLog.error(this, 'Error sending stop runtime command', error);
                reject(error);
            }
        });
    }

    async shutdown(): Promise<void> {
        if (!this.process) {
            return;
        }

        GGLog.debug(this, 'Shutting down process...');

        return new Promise<void>((resolve) => {
            if (!this.process) {
                resolve();
                return;
            }

            this.process.once('exit', () => {
                clearTimeout(forceKillTimeout);
                this.process = undefined;
                GGLog.debug(this, 'Process shut down');
                resolve();
            });

            // Send shutdown message via stdin (works cross-platform, unlike SIGTERM on Windows)
            try {
                this.process.stdin?.write('SHUTDOWN\n');
                this.process.stdin?.end();
                GGLog.debug(this, 'Sent shutdown command via stdin');
            } catch (error) {
                GGLog.error(this, 'Error sending shutdown command', error);
            }

            // Force kill after 2 seconds if still running
            const forceKillTimeout = setTimeout(() => {
                if (this.process && !this.process.killed) {
                    GGLog.debug(this, 'Process did not exit gracefully, force killing');
                    this.process.kill('SIGKILL');
                    this.process = undefined;
                }
            }, 2000);
        });
    }
}
