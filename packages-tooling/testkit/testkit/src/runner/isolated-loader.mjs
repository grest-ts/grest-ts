/**
 * Isolated process loader for ES modules
 * This file is the entry point for isolated test processes
 *
 * Usage: npx tsx isolated-loader.mjs <runtime-source-url>
 * Environment: GG_ISOLATED_CONFIG must be set with JSON config
 */
import {register} from 'tsx/esm/api';
import {pathToFileURL} from 'url';

// Register tsx to handle TypeScript with ESM
register();

// Get the runtime source URL from command line args (can be file:// URL or path)
let runtimeSourceUrl = process.argv[2];
if (!runtimeSourceUrl) {
    console.error('Usage: npx tsx isolated-loader.mjs <runtime-source-url>');
    process.exit(1);
}

// Convert to file:// URL if it's a path
if (!runtimeSourceUrl.startsWith('file:')) {
    runtimeSourceUrl = pathToFileURL(runtimeSourceUrl).href;
}

const GG_ISOLATED_CONFIG = "GG_ISOLATED_CONFIG";
const PROCESS_READY = "IsolatedRunner:READY";

// Get config from environment
const configJson = process.env[GG_ISOLATED_CONFIG];
if (!configJson) {
    console.error('GG_ISOLATED_CONFIG not set');
    process.exit(1);
}

// Import runtime and testkit dependencies
const {GGRuntime} = await import('@grest-ts/runtime');
const {GGTestRuntimeWorker} = await import('@grest-ts/testkit');
const {GGLog} = await import('@grest-ts/logger');

const config = JSON.parse(configJson);

// Override cli() to intercept runtime startup in isolated mode

GGRuntime.cli = async function(moduleUrl) {
    // Still set SOURCE_MODULE_URL for testkit compatibility
    this.SOURCE_MODULE_URL = moduleUrl;

    // Start the runtime via test worker instead of normal startup
    const controlClient = new GGTestRuntimeWorker(config);

    try {
        await controlClient.start(() => new this());

        // Signal to parent process that we're ready
        console.log(PROCESS_READY);

        const stopRuntime = async () => {
            // Stop the GGRuntime but keep process alive for log retrieval
            await controlClient.stopRuntime();
            console.log('IsolatedRunner:RUNTIME_STOPPED');
        };

        const shutdown = async () => {
            // Fully shutdown process
            await controlClient.shutdown();
            process.exit(0);
        };

        // Listen for commands via stdin
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (data) => {
            const message = data.toString().trim();
            if (message === 'STOP_RUNTIME') {
                GGLog.debug({name: 'IsolatedLoader'}, 'Received stop runtime command');
                stopRuntime();
            } else if (message === 'SHUTDOWN') {
                GGLog.debug({name: 'IsolatedLoader'}, 'Received shutdown command');
                shutdown();
            }
        });
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    } catch (err) {
        GGLog.error({name: 'IsolatedLoader'}, 'Failed to start isolated runtime', err);
        process.exit(1);
    }
};

// Import the runtime source - this will call the overridden cli()
await import(runtimeSourceUrl);
