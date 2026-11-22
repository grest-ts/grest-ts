import {GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {GGContextKey, GGContextStore} from "@grest-ts/context"
import {GGLocator} from "@grest-ts/locator"
import {IsBoolean} from "@grest-ts/schema"
import {GG_TRACE} from "@grest-ts/trace"

export const SEALED_ROOT_PATH = "/sealed-root/probe"
const MARK = new GGContextKey<boolean>("sealed-root-mark", IsBoolean)

/** Work left running in the root context after start: a raw interval, and a scope timer set in compose. */
export class SealedRootRuntime extends GGRuntime {
    public static readonly NAME = "sealed-root"

    protected compose(): void {
        let raw: string | undefined
        const rawInterval = setInterval(() => {
            try {
                MARK.set(true)
                raw = "set"
            } catch (err) {
                raw = (err as Error).message
                clearInterval(rawInterval)
            }
        }, 20)
        rawInterval.unref()

        const timerFires: {context?: string, traceId?: string, marked: boolean}[] = []
        GGLocator.setInterval(() => {
            timerFires.push({context: GGContextStore.tryGetContext()?.name, traceId: GG_TRACE.get()?.traceId, marked: MARK.has()})
            MARK.set(true)
        }, 20)

        const httpServer = new GGHttpServer()
        httpServer.registerRoute("GET", SEALED_ROOT_PATH, async (_req, res) => {
            res.writeHead(200, {"content-type": "application/json"})
            res.end(JSON.stringify({raw, timerFires: timerFires.slice(-2), marked: MARK.has()}))
        })
        httpServer.announce(SEALED_ROOT_PATH, "SealedRoot")
    }
}

SealedRootRuntime.cli(import.meta.url).then()
