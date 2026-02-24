import {PollerHandler, PollerReport} from "@grest-ts/poller";

export type TestItemStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TestItemEntry<T> {
    data: T;
    status: TestItemStatus;
    attempts: number;
    lastError?: Error;
    createdAt: number;
    completedAt?: number;
}

/**
 * In-memory item store for testing.
 * Tracks item state and provides a handler compatible with GGPoller.
 *
 * @example
 * ```typescript
 * const store = new GGTestPollerStore<{email: string}>();
 *
 * // Add some items
 * store.addItem({ email: 'test@example.com' });
 *
 * // Create poller with store handler
 * const poller = new GGPoller(config, lock, store.createHandler(
 *   async (data) => { await sendEmail(data.email); }
 * ));
 * ```
 */
export class GGTestPollerStore<T extends { id: string }> {
    private readonly items = new Map<string, TestItemEntry<T>>();

    // For testing: track all operations
    public readonly getDataCalls: Array<{limit: number; returned: number; timestamp: number}> = [];
    public readonly runCalls: Array<{itemId: string; success: boolean; timestamp: number}> = [];
    public readonly completedReports: Array<{report: PollerReport; timestamp: number}> = [];

    /**
     * Add an item to the store.
     */
    addItem(data: T, status: TestItemStatus = 'pending'): void {
        this.items.set(data.id, {
            data,
            status,
            attempts: 0,
            createdAt: Date.now()
        });
    }

    /**
     * Add multiple items at once.
     */
    addItems(items: T[]): void {
        for (const item of items) {
            this.addItem(item);
        }
    }

    /**
     * Get an item by ID.
     */
    getItem(id: string): TestItemEntry<T> | undefined {
        return this.items.get(id);
    }

    /**
     * Get all items.
     */
    getAllItems(): TestItemEntry<T>[] {
        return Array.from(this.items.values());
    }

    /**
     * Get items by status.
     */
    getItemsByStatus(status: TestItemStatus): TestItemEntry<T>[] {
        return Array.from(this.items.values()).filter(e => e.status === status);
    }

    /**
     * Get pending item count.
     */
    getPendingCount(): number {
        return this.getItemsByStatus('pending').length;
    }

    /**
     * Get completed item count.
     */
    getCompletedCount(): number {
        return this.getItemsByStatus('completed').length;
    }

    /**
     * Get failed item count.
     */
    getFailedCount(): number {
        return this.getItemsByStatus('failed').length;
    }

    /**
     * Create a handler for use with GGPoller.
     *
     * @param taskHandler - Your business logic for processing an item
     * @param options - Optional configuration
     */
    createHandler(
        taskHandler: (data: T) => Promise<void>,
        options: {
            maxAttempts?: number;
            markAsProcessingOnFetch?: boolean;
        } = {}
    ): PollerHandler<T> {
        const {maxAttempts = 3, markAsProcessingOnFetch = true} = options;

        return {
            getData: async (limit: number): Promise<T[]> => {
                const pending = this.getItemsByStatus('pending')
                    .sort((a, b) => a.createdAt - b.createdAt)
                    .slice(0, limit);

                if (markAsProcessingOnFetch) {
                    for (const entry of pending) {
                        entry.status = 'processing';
                    }
                }

                this.getDataCalls.push({
                    limit,
                    returned: pending.length,
                    timestamp: Date.now()
                });

                return pending.map(e => e.data);
            },

            run: async (data: T): Promise<void> => {
                const entry = this.items.get(data.id);
                if (entry) {
                    entry.attempts++;
                }

                let success = false;
                try {
                    await taskHandler(data);
                    success = true;

                    // Mark as completed
                    if (entry) {
                        entry.status = 'completed';
                        entry.completedAt = Date.now();
                    }
                } catch (e) {
                    // Mark as failed or pending for retry
                    if (entry) {
                        entry.lastError = e instanceof Error ? e : new Error(String(e));
                        if (entry.attempts >= maxAttempts) {
                            entry.status = 'failed';
                        } else {
                            entry.status = 'pending';
                        }
                    }
                    throw e;
                } finally {
                    this.runCalls.push({
                        itemId: data.id,
                        success,
                        timestamp: Date.now()
                    });
                }
            },

            onCompleted: (report: PollerReport): void => {
                this.completedReports.push({
                    report,
                    timestamp: Date.now()
                });
            }
        };
    }

    /**
     * Clear all items and history.
     */
    reset(): void {
        this.items.clear();
        this.getDataCalls.length = 0;
        this.runCalls.length = 0;
        this.completedReports.length = 0;
    }

    /**
     * Wait for all items to reach a terminal state (completed or failed).
     * Useful for testing.
     */
    async waitForAllComplete(timeoutMs: number = 5000): Promise<void> {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const pending = this.getItemsByStatus('pending').length;
            const processing = this.getItemsByStatus('processing').length;

            if (pending === 0 && processing === 0) {
                return;
            }

            await new Promise(r => setTimeout(r, 50));
        }

        throw new Error(`Timeout waiting for items to complete. Pending: ${this.getPendingCount()}, Processing: ${this.getItemsByStatus('processing').length}`);
    }
}
