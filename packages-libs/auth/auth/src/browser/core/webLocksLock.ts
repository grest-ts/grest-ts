/// <reference lib="dom" />
import type {CrossTabLock} from "./types"
import {ggAuthLog} from "./authDebug"

// Cap how long we wait to ACQUIRE the lock. A tab can grab "auth-refresh" and
// then be suspended/throttled (its timers frozen) so it never releases — without
// a bound, every other tab's authed call would hang forever waiting (the symptom:
// "loading forever", no request in the network tab). Longer than the http client's
// own per-request timeout (15s) so a legitimately busy holder always finishes
// first and only a truly stuck holder is abandoned; on timeout the waiter rejects
// (caller degrades and retries on the next call) instead of freezing. The signal
// is ignored once the lock is granted, so it can't cut a refresh short.
const ACQUIRE_TIMEOUT_MS = 20_000

export function webLocksLock(): CrossTabLock {
    if (typeof navigator !== "undefined" && navigator.locks) {
        return {
            withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
                const controller = new AbortController()
                const timer = setTimeout(() => {
                    ggAuthLog(`webLocksLock: ABORTING acquire of "${name}" after ${ACQUIRE_TIMEOUT_MS}ms (stuck holder?)`)
                    controller.abort()
                }, ACQUIRE_TIMEOUT_MS)
                ggAuthLog(`webLocksLock: requesting "${name}"`)
                return (navigator.locks.request(name, {signal: controller.signal}, (lock) => {
                    ggAuthLog(`webLocksLock: granted "${name}"`, {lock: !!lock})
                    return (fn() as Promise<T>).finally(() => ggAuthLog(`webLocksLock: releasing "${name}"`))
                }) as Promise<T>)
                    .catch((e) => { ggAuthLog(`webLocksLock: "${name}" rejected (abort/timeout?)`, e); throw e })
                    .finally(() => clearTimeout(timer))
            },
        }
    }

    ggAuthLog("webLocksLock: navigator.locks UNAVAILABLE, using in-tab promise-chain serialization")
    // navigator.locks unavailable (e.g. non-secure context) — in-tab promise-chain serializes.
    let tail: Promise<void> = Promise.resolve()
    return {
        withLock<T>(_name: string, fn: () => Promise<T>): Promise<T> {
            const next: Promise<T> = tail.then(() => fn())
            tail = next.then((): void => undefined, (): void => undefined)
            return next
        },
    }
}
