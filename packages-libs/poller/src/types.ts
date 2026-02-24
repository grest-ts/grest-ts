
/**
 * User-provided handler for poll-based job processing.
 * This is where the actual work happens.
 *
 * @template T - The type of data items to process
 */
export interface PollerHandler<T> {
    /**
     * Collector phase: Fetch pending items from your data store.
     *
     * This should:
     * - Query for items that need processing (e.g., WHERE status='pending')
     * - Limit results to `limit` items
     * - Optionally mark them as "processing" to prevent re-fetch
     *
     * @param limit - Maximum number of items to return (from config.batchSize)
     * @returns Array of items to process (may be empty)
     */
    getData(limit: number): Promise<T[]>;

    /**
     * Process a single item. This is your business logic.
     *
     * If this throws, the item is considered failed.
     * You are responsible for marking items as complete in your data store.
     *
     * @param data - The item to process
     */
    run(data: T): Promise<void>;

    /**
     * Called after each batch is processed.
     * Use this for logging, metrics, or cleanup.
     *
     * @param report - Summary of what happened in this batch
     */
    onCompleted(report: PollerReport): void;
}

/**
 * Report provided to onCompleted after each batch.
 */
export interface PollerReport {
    /** Number of items successfully processed */
    readonly processed: number;

    /** Number of items that failed */
    readonly failed: number;

    /** Total duration of the batch in milliseconds */
    readonly durationMs: number;

    /** Whether the batch was empty (no items to process) */
    readonly empty: boolean;
}

/**
 * Current state of the poller.
 */
export type PollerState =
    | 'stopped'      // Not running
    | 'waiting'      // Running but waiting to acquire lock
    | 'leader'       // We are the leader, processing items
    | 'stopping';    // Graceful shutdown in progress
