import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {SEALED_ROOT_PATH, SealedRootRuntime} from "../src/SealedRootRuntime"

type Probe = {
    raw?: string,
    timerFires: {context?: string, traceId?: string, marked: boolean}[],
    chainFires: {traceId?: string, marked: boolean}[],
    requestTimer?: {context?: string, marked: boolean},
    marked: boolean,
}

async function probe(): Promise<Probe> {
    const res = await fetch(`${GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(`SealedRoot:${SEALED_ROOT_PATH}`)}${SEALED_ROOT_PATH}`)
    return await res.json() as Probe
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

    test("a scope timer that reschedules itself runs every fire as a unit of its own", async () => {
        await vi.waitFor(async () => expect((await probe()).chainFires).toHaveLength(3))
        const fires = (await probe()).chainFires
        expect(fires.map(f => f.marked)).toEqual([false, false, false])
        expect(new Set(fires.map(f => f.traceId)).size).toBe(3)
    })

    test("a scope timer set from a request runs as its own unit, without the request's values", async () => {
        await probe()
        await vi.waitFor(async () => expect((await probe()).requestTimer).toEqual({context: "TIMER", marked: false}))
    })
})
