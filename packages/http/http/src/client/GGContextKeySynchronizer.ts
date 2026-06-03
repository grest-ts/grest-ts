import {GGContextKey} from "@grest-ts/context"
import {IsAny, type GGSchema} from "@grest-ts/schema"

export interface GGKeyController {
    isStale: () => boolean
    recover: () => Promise<void>
}

interface ControllerEntry {
    controller: GGKeyController
    inflight: Promise<void> | undefined
}

const GG_SYNC_CONTROLLERS = new GGContextKey<Map<string, ControllerEntry>>(
    "sync:controllers",
    IsAny as unknown as GGSchema<Map<string, ControllerEntry>>
)

// Backstop so a stuck recover() can't hang every gated request forever. A recover() that
// never settles - e.g. a credential whose refresh endpoint is itself gated by the same wire,
// so the refresh call waits on the recover that is waiting on it (circular wait) - would
// otherwise block the outbound read with no request ever issued. Bounded well above a healthy
// recover (lock acquire 20s + request 15s) so only a truly stuck one trips; on timeout the
// waiter rejects and the caller fails/retries instead of freezing.
const RECOVER_TIMEOUT_MS = 45_000

function withRecoverTimeout(recover: Promise<void>, name: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Credential recover for "${name}" timed out after ${RECOVER_TIMEOUT_MS}ms (stuck/circular refresh?)`)),
            RECOVER_TIMEOUT_MS,
        )
        recover.then(resolve, reject).finally(() => clearTimeout(timer))
    })
}

export class GGContextKeySynchronizer {

    static provide(key: GGContextKey<any>, controller: GGKeyController): void {
        let registry = GG_SYNC_CONTROLLERS.get()
        if (registry === undefined) {
            registry = new Map()
            GG_SYNC_CONTROLLERS.set(registry)
        }
        registry.set(key.name, {controller, inflight: undefined})
    }

    static async waitFor(key: GGContextKey<any>): Promise<void> {
        const entry = GG_SYNC_CONTROLLERS.get()?.get(key.name)
        if (entry === undefined || !entry.controller.isStale()) return
        entry.inflight ??= withRecoverTimeout(entry.controller.recover(), key.name).finally(() => {
            entry.inflight = undefined
        })
        await entry.inflight
    }

    static clear(key: GGContextKey<any>): void {
        GG_SYNC_CONTROLLERS.get()?.delete(key.name)
    }
}
