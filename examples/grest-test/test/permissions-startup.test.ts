import {GGTest} from "@grest-ts/testkit"
import {StartupCheckAllPublicRuntime} from "../src/StartupCheckAllPublicRuntime"
import {StartupCheckBadRuntime} from "../src/StartupCheckBadRuntime"
import {StartupCheckOrderRuntime} from "../src/StartupCheckOrderRuntime"

async function expectComposeToThrow(runtime: any): Promise<Error> {
    let caught: unknown = undefined
    try {
        await GGTest.startInline(runtime)
    } catch (e) {
        caught = e
    }
    expect(caught).toBeDefined()
    return caught as Error
}

describe("permission startup check", () => {

    test("non-public schema without .usePermissions() throws at compose with an actionable error", async () => {
        const e = await expectComposeToThrow(StartupCheckBadRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toMatch(/cannot register StartupCheckBad/)
        expect(msg).toContain("StartupCheckBad.needsScope")
        expect(msg).toContain('requires "startup:check"')
        expect(msg).toMatch(/usePermissions/)
        expect(msg).toMatch(/GG_NO_PERMISSIONS/)
    })

    test("all-public schema without a resolver starts silently — no warning, no error", async () => {
        // No assertion needed beyond "startInline does not throw".
        await GGTest.startInline(StartupCheckAllPublicRuntime)
    })

    test("calling .http(api) before .usePermissions(resolver) still triggers the check", async () => {
        // Order-sensitive: http() snapshots an undefined resolver, so the
        // non-public method's registration fails even though .usePermissions()
        // is wired later in the chain.
        const e = await expectComposeToThrow(StartupCheckOrderRuntime)
        expect(e.message).toMatch(/cannot register StartupCheckBad/)
        expect(e.message).toContain("StartupCheckBad.needsScope")
    })
})
