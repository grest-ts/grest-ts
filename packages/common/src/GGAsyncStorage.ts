export interface IAsyncStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, fn: () => R): R;
    enterWith(store: T): void;
}

export class BrowserAsyncStorage<T> implements IAsyncStorage<T> {
    private store: T | undefined;

    getStore(): T | undefined {
        return this.store;
    }

    run<R>(store: T, fn: () => R): R {
        const prev = this.store;
        this.store = store;
        try {
            return fn();
        } finally {
            this.store = prev;
        }
    }

    enterWith(store: T): void {
        this.store = store;
    }
}
