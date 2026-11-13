/**
 * Worker loader for ES modules
 * This file is loaded by worker threads to execute test runtimes
 *
 * workerData is GGTestEnvConfig: { executablePath, testRouterPort, testId, runtimeId, initialCommands }
 * A released worker keeps its loaded modules and starts a fresh runtime instance on the next 'start' message.
 */
import {register} from 'tsx/esm/api';
import {parentPort, workerData} from 'worker_threads';

// Register tsx to handle TypeScript with ESM
register();

let config = workerData;

// Catch unhandled errors in worker thread
process.on('uncaughtException', (err) => {
    console.error(`[WorkerThread ${config?.runtimeId}] Uncaught exception:`, err);
});
process.on('unhandledRejection', (reason) => {
    console.error(`[WorkerThread ${config?.runtimeId}] Unhandled rejection:`, reason);
});

// Import control client from @grest-ts/testkit; the test clock goes in before any app module loads
const {GGTestRuntimeWorker, installTestClock, bootClock} = await import('@grest-ts/testkit');
installTestClock();

let controlClient;

async function start() {
    bootClock(config.clock);
    controlClient = new GGTestRuntimeWorker(config);
    try {
        await controlClient.start();
        parentPort.postMessage({type: 'ready'});
    } catch (err) {
        parentPort.postMessage({type: 'error', error: err.stack || err.message});
    }
}

await start();

// Handle messages from parent
parentPort.on('message', async (msg) => {
    if (msg.type === 'stopRuntime') {
        // Stop the GGRuntime but keep worker alive for log retrieval
        await controlClient.stopRuntime();
        parentPort.postMessage({type: 'runtimeStopped'});
    } else if (msg.type === 'shutdown') {
        // Fully shutdown worker
        await controlClient.shutdown();
        process.exit(0);
    } else if (msg.type === 'release') {
        await controlClient.shutdown();
        parentPort.postMessage({type: 'released'});
    } else if (msg.type === 'start') {
        // The parent's env as of this start, as a fresh worker would have copied it.
        for (const key of Object.keys(process.env)) if (!(key in msg.env)) delete process.env[key];
        Object.assign(process.env, msg.env);
        config = msg.config;
        await start();
    }
});
