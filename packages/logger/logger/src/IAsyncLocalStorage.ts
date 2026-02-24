import {AsyncLocalStorage} from 'node:async_hooks'

export interface IAsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;

    getStore(): T | undefined;

    exit<R>(callback: () => R): R;

    enterWith(store: T): void;
}

class BrowserAsyncLocalStorage<T> implements IAsyncLocalStorage<T> {
    private store: T | undefined = undefined;

    run<R>(store: T, callback: () => R): R {
        const previousStore = this.store;
        this.store = store;
        try {
            return callback();
        } finally {
            this.store = previousStore;
        }
    }

    getStore(): T | undefined {
        return this.store;
    }

    exit<R>(callback: () => R): R {
        const previousStore = this.store;
        this.store = undefined;
        try {
            return callback();
        } finally {
            this.store = previousStore;
        }
    }

    enterWith(store: T): void {
        this.store = store;
    }
}

const isBrowser = typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).window !== 'undefined' &&
    typeof (globalThis as any).window.document !== 'undefined';

// Export the appropriate implementation based on environment
// In browser: use BrowserAsyncLocalStorage
// In Node.js: use native AsyncLocalStorage from async_hooks
export const AsyncLocalStorageImpl: new <T>() => IAsyncLocalStorage<T> =
    isBrowser ? BrowserAsyncLocalStorage : (AsyncLocalStorage as any);