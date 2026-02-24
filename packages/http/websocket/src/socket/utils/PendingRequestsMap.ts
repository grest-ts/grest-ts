import {ERROR_JSON, OK_JSON, SERVER_ERROR} from "@grest-ts/schema";

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: any;
    path: string;
}

export type tPendingMessageId = string & { tt: never };

export class PendingRequestsMap {
    private readonly requests: Map<tPendingMessageId, PendingRequest> = new Map();
    private requestIdCounter: number = 1;
    // Callbacks waiting for the map to drain (become empty)
    private drainCallbacks: Array<() => void> = [];

    /**
     * Get the number of pending requests
     */
    public get size(): number {
        return this.requests.size;
    }

    /**
     * Check if there are any pending requests
     */
    public hasPending(): boolean {
        return this.requests.size > 0;
    }

    /**
     * Wait for all pending requests to complete (resolve or reject).
     * Uses event-driven notification instead of polling.
     * @param timeoutMs - Maximum time to wait for pending requests
     * @returns Promise that resolves when all pending requests are done or timeout is reached
     */
    public waitForPending(timeoutMs: number = 5000): Promise<void> {
        if (this.requests.size === 0) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            const cleanup = () => {
                clearTimeout(timeout);
                const idx = this.drainCallbacks.indexOf(onDrain);
                if (idx !== -1) this.drainCallbacks.splice(idx, 1);
            };

            const onDrain = () => {
                cleanup();
                resolve();
            };

            const timeout = setTimeout(() => {
                cleanup();
                resolve(); // Resolve on timeout (caller checks hasPending)
            }, timeoutMs);

            this.drainCallbacks.push(onDrain);
        });
    }

    /**
     * Notify drain callbacks if map is empty
     */
    private notifyDrainIfEmpty(): void {
        if (this.requests.size === 0 && this.drainCallbacks.length > 0) {
            const callbacks = [...this.drainCallbacks];
            this.drainCallbacks = [];
            callbacks.forEach(cb => cb());
        }
    }

    public create(
        path: string,
        timeoutMs: number,
        callback: (id: tPendingMessageId, waitForResponsePromise: Promise<any>) => Promise<any>
    ): Promise<any> {
        const requestId = String(this.requestIdCounter++) as tPendingMessageId;
        const reqPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.requests.delete(requestId);
                this.notifyDrainIfEmpty();
                reject(new SERVER_ERROR({
                    displayMessage: 'Request timeout',
                    debugData: {
                        timeout: timeoutMs,
                    }
                }));
            }, timeoutMs);
            this.requests.set(requestId, {resolve, reject, timeout, path});
        });

        return callback(requestId, reqPromise)
            .catch((error) => {
                // If callback throws an error, clean up the pending request
                const pending = this.requests.get(requestId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.requests.delete(requestId);
                    this.notifyDrainIfEmpty();
                }
                throw error;
            });
    }

    public resolve(requestId: tPendingMessageId, value: OK_JSON<any> | ERROR_JSON): boolean {
        const pending = this.requests.get(requestId);
        if (!pending) {
            throw new Error('Pending request not found: ' + requestId);
        }
        clearTimeout(pending.timeout);
        this.requests.delete(requestId);
        pending.resolve(value);
        this.notifyDrainIfEmpty();
        return true;
    }

    public rejectAll(error: typeof SERVER_ERROR.infer): void {
        this.requests.forEach((pending) => {
            clearTimeout(pending.timeout);
            pending.resolve(error.toJSON());
        });
        this.requests.clear();
        this.notifyDrainIfEmpty();
    }
}
