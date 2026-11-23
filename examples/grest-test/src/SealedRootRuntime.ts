import {GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {GGContextKey, GGContextStore} from "@grest-ts/context"
import {GGLocator} from "@grest-ts/locator"
import {IsBoolean} from "@grest-ts/schema"
import {GG_TRACE} from "@grest-ts/trace"

export const SEALED_ROOT_PATH = "/sealed-root/probe"
const MARK = new GGContextKey<boolean>("sealed-root-mark", IsBoolean)

/** Work left running in the root context after start: a raw interval, scope timers set in compose, and a scope timer
 *  set from a request. */
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

        // Reschedules itself from inside each fire, as the job runner's loop does.
        const chainFires: {traceId?: string, marked: boolean}[] = []
        const chain = () => {
            chainFires.push({traceId: GG_TRACE.get()?.traceId, marked: MARK.has()})
            MARK.set(true)
            if (chainFires.length < 3) GGLocator.setTimeout(chain, 10)
        }
        GGLocator.setTimeout(chain, 10)

        let requestTimer: {context?: string, marked: boolean} | undefined
        const httpServer = new GGHttpServer()
        httpServer.registerRoute("GET", SEALED_ROOT_PATH, async (_req, res) => {
            const marked = MARK.has()
            MARK.set(true)
            GGLocator.setTimeout(() => requestTimer = {context: GGContextStore.tryGetContext()?.name, marked: MARK.has()}, 0)
            res.writeHead(200, {"content-type": "application/json"})
            res.end(JSON.stringify({raw, timerFires: timerFires.slice(-2), chainFires, requestTimer, marked}))
        })
        httpServer.announce(SEALED_ROOT_PATH, "SealedRoot")
    }
}

SealedRootRuntime.cli(import.meta.url).then()
