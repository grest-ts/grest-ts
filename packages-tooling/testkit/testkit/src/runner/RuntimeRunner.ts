export interface RuntimeRunner {
    start(): Promise<void>;

    /**
     * Stop the GGRuntime (teardown services) but keep the worker/IPC alive.
     * This allows log retrieval after the runtime has stopped.
     */
    stopRuntime(): Promise<void>;

    /**
     * Fully shutdown the worker, including IPC disconnection.
     * After this, no commands can be sent.
     */
    shutdown(): Promise<void>;
}
