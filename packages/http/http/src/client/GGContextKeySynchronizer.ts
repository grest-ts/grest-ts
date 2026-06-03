import {GGContextKey} from "@grest-ts/context"
import {IsAny, type GGSchema} from "@grest-ts/schema"
import {ggAuthLog} from "./authDebug"

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
        if (entry === undefined) return
        if (!entry.controller.isStale()) {
            ggAuthLog(`waitFor("${key.name}"): fresh, passing through`)
            return
        }
        if (entry.inflight) {
            ggAuthLog(`waitFor("${key.name}"): stale, joining inflight recover`)
        } else {
            ggAuthLog(`waitFor("${key.name}"): stale, starting recover() — request is BLOCKED until this resolves`)
            entry.inflight = entry.controller.recover().then(
                () => { ggAuthLog(`waitFor("${key.name}"): recover() resolved, request may proceed`) },
                (e) => { ggAuthLog(`waitFor("${key.name}"): recover() REJECTED`, e); throw e },
            ).finally(() => {
                entry.inflight = undefined
            })
        }
        await entry.inflight
    }

    static clear(key: GGContextKey<any>): void {
        GG_SYNC_CONTROLLERS.get()?.delete(key.name)
    }
}
