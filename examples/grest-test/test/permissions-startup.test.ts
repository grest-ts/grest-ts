import {GGTest} from "@grest-ts/testkit"
import {StartupCheckBadRuntime} from "../src/StartupCheckBadRuntime"

describe("permission startup check (negative)", () => {

    test("registering a non-public schema without .usePermissions() throws at compose with an actionable error", async () => {
        let caught: unknown = undefined
        try {
            // Inside the test block, startInline starts immediately and rejects on compose failure.
            await GGTest.startInline(StartupCheckBadRuntime)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeDefined()
        const msg: string = (caught as Error)?.message ?? String(caught)
        expect(msg).toMatch(/cannot register StartupCheckBad/)
        expect(msg).toContain("StartupCheckBad.needsScope")
        expect(msg).toContain('requires "startup:check"')
        expect(msg).toMatch(/usePermissions/)
        expect(msg).toMatch(/GG_NO_PERMISSIONS/)
    })
})
