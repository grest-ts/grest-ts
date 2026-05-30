import {GGContextKey} from "./GGContextKey"
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
        entry.inflight ??= entry.controller.recover().finally(() => {
            entry.inflight = undefined
        })
        await entry.inflight
    }

    static clear(key: GGContextKey<any>): void {
        GG_SYNC_CONTROLLERS.get()?.delete(key.name)
    }
}
