/// <reference lib="dom" />
import type {CrossTabLock} from "./types"

export function webLocksLock(): CrossTabLock {
    if (typeof navigator !== "undefined" && navigator.locks) {
        return {
            withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
                return navigator.locks.request(name, fn as () => T) as Promise<T>
            },
        }
    }

    // navigator.locks unavailable (e.g. non-secure context) — in-tab promise-chain serializes.
    let tail: Promise<void> = Promise.resolve()
    return {
        withLock<T>(_name: string, fn: () => Promise<T>): Promise<T> {
            const next: Promise<T> = tail.then(() => fn())
            tail = next.then(() => undefined, () => undefined)
            return next
        },
    }
}
