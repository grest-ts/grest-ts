import {GGTest} from "@grest-ts/testkit"
import {
    DupRouteRuntime,
    UnsatisfiableRuntime,
    WireConflictRuntime,
    WsDeadPushRuntime,
} from "../src/WiringCheckRuntimes"

async function expectStartToThrow(runtime: any): Promise<Error> {
    let caught: unknown = undefined
    try {
        await GGTest.startInline(runtime)
    } catch (e) {
        caught = e
    }
    expect(caught).toBeDefined()
    return caught as Error
}

describe("startup wiring checks", () => {

    test("duplicate method+path across schemas — start throws naming both", async () => {
        const e = await expectStartToThrow(DupRouteRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toMatch(/declared by both/i)
        expect(msg).toContain("DupRouteA.thing")
        expect(msg).toContain("DupRouteB.other")
        expect(msg).toContain("/api/dup/same")
    })

    test("permissioned route with no permission-resolving wire — start throws as unsatisfiable", async () => {
        const e = await expectStartToThrow(UnsatisfiableRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toMatch(/can never pass the gate|permanently FORBIDDEN/i)
        expect(msg).toContain("Unsatisfiable.needsScope")
    })

    test("two wires sharing a context-key name / header on one schema — start throws", async () => {
        const e = await expectStartToThrow(WireConflictRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toMatch(/conflicting wires/i)
        expect(msg).toContain("WireConflict")
        expect(msg).toMatch(/context-key name "x-token"|header "x-token"/)
    })

    test("non-public permission on a WS serverToClient method — start throws as dead config", async () => {
        const e = await expectStartToThrow(WsDeadPushRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toMatch(/serverToClient/i)
        expect(msg).toContain("WsDeadPush.push")
    })
})
