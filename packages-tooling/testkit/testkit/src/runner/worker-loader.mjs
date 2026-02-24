/**
 * Worker loader for ES modules
 * This file is loaded by worker threads to execute test runtimes
 *
 * workerData is GGTestEnvConfig: { executablePath, testRouterPort, testId, runtimeId, initialCommands }
 */
import {register} from 'tsx/esm/api';
import {parentPort, workerData} from 'worker_threads';

// Register tsx to handle TypeScript with ESM
register();

// Catch unhandled errors in worker thread
process.on('uncaughtException', (err) => {
    console.error(`[WorkerThread ${workerData?.runtimeId}] Uncaught exception:`, err);
});
process.on('unhandledRejection', (reason) => {
    console.error(`[WorkerThread ${workerData?.runtimeId}] Unhandled rejection:`, reason);
});

// workerData is GGTestEnvConfig directly
const config = workerData;

// Import control client from @grest-ts/testkit
const {GGTestRuntimeWorker} = await import('@grest-ts/testkit');

// Create control client
const controlClient = new GGTestRuntimeWorker(config);

// Start the runtime
try {
    await controlClient.start();
    parentPort.postMessage({type: 'ready'});
} catch (err) {
    parentPort.postMessage({type: 'error', error: err.stack || err.message});
}

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
    }
});
