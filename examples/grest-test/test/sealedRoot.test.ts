import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {SEALED_ROOT_PATH, SEALED_ROOT_PREFIX, SEALED_ROOT_TICKER_PATH, SealedRootRuntime} from "../src/SealedRootRuntime"

type Fire = {context?: string, traceId?: string, marked: boolean}
type Probe = {raw?: string, timerFires: Fire[], tickerFires: Fire[], requestTraceId?: string, marked: boolean}

const url = (path: string) => `${GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(`SealedRoot:${SEALED_ROOT_PREFIX}`)}${path}`

async function probe(): Promise<Probe> {
    return await (await fetch(url(SEALED_ROOT_PATH))).json() as Probe
}

describe("a running runtime's root context", () => {
    GGTest.startInline(SealedRootRuntime)

    test("is sealed: code still running in it can't set a value every later request would inherit", async () => {
        await vi.waitFor(async () => expect((await probe()).raw).toMatch(/Context 'Runtime' is sealed/))
        expect((await probe()).marked).toBe(false)
    })

    test("a scope timer set in compose runs each fire as its own unit of work", async () => {
        await vi.waitFor(async () => expect((await probe()).timerFires).toHaveLength(2))
        const [a, b] = (await probe()).timerFires
        expect([a.context, b.context]).toEqual(["TIMER", "TIMER"])
        expect([a.marked, b.marked]).toEqual([false, false])
        expect(a.traceId).not.toBe(b.traceId)
    })

    test("a scope timer a request starts runs each fire in a child of that request, so fires can set what the last one did", async () => {
        expect((await fetch(url(SEALED_ROOT_TICKER_PATH), {method: "POST"})).status).toBe(204)
        await vi.waitFor(async () => expect((await probe()).tickerFires).toHaveLength(2))
        const {tickerFires: [a, b], requestTraceId} = await probe()
        expect([a.context, b.context]).toEqual(["TIMER", "TIMER"])
        expect([a.marked, b.marked]).toEqual([false, false])
        expect([a.traceId, b.traceId]).toEqual([requestTraceId, requestTraceId])
    })
})
