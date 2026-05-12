import {GGTest} from "@grest-ts/testkit"
import {StartupCheckAllPublicRuntime} from "../src/StartupCheckAllPublicRuntime"
import {StartupCheckBadRuntime} from "../src/StartupCheckBadRuntime"
import {StartupCheckOrderRuntime} from "../src/StartupCheckOrderRuntime"
import {StartupCheckZeroConfigRuntime} from "../src/StartupCheckZeroConfigRuntime"
import {StartupCheckInfectiousRuntime} from "../src/StartupCheckInfectiousRuntime"
import {StartupCheckInfectiousReverseRuntime} from "../src/StartupCheckInfectiousReverseRuntime"
import {StartupCheckWsTriggersHttpRuntime} from "../src/StartupCheckWsTriggersHttpRuntime"

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

describe("permission startup check", () => {

    test("zero-config: no permissions declared anywhere, no usePermissions — starts silently", async () => {
        await GGTest.startInline(StartupCheckZeroConfigRuntime)
    })

    test("all routes declared GG_NO_PERMISSIONS, no resolver — starts silently", async () => {
        // Strict mode is triggered by the explicit declarations, but every
        // route satisfies it and nothing requires gating.
        await GGTest.startInline(StartupCheckAllPublicRuntime)
    })

    test("non-public route without .usePermissions() — start throws naming the route", async () => {
        const e = await expectStartToThrow(StartupCheckBadRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toContain("StartupCheckBad.needsScope")
        expect(msg).toContain('"startup:check"')
        expect(msg).toMatch(/usePermissions/)
    })

    test("infectious rule: one contract declares, sibling contract on the same server hasn't — start throws", async () => {
        const e = await expectStartToThrow(StartupCheckInfectiousRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toMatch(/strict mode/i)
        expect(msg).toContain("StartupCheckUndeclared.forgotten")
        expect(msg).toMatch(/GG_NO_PERMISSIONS/)
    })

    test("infectious rule is order-independent: registering the undeclared contract first still fails", async () => {
        // Sibling check: same content as StartupCheckInfectiousRuntime but the
        // .http() calls are reversed. The per-server check runs at start, so
        // registration order doesn't matter.
        const e = await expectStartToThrow(StartupCheckInfectiousReverseRuntime)
        expect(e.message).toContain("StartupCheckUndeclared.forgotten")
    })

    test("a WS connectPermission declaration trips strict mode for HTTP routes on the same server", async () => {
        // WS schema only declares `connectPermission` (no per-c2s-method
        // permissions). That single declaration is enough to flip strict
        // mode on the shared GGHttpServer, so the HTTP routes that omitted
        // `permission` get caught by the per-server check.
        const e = await expectStartToThrow(StartupCheckWsTriggersHttpRuntime)
        const msg = e.message ?? String(e)
        expect(msg).toMatch(/strict mode/i)
        expect(msg).toContain("StartupCheckZeroConfig.hello")
        expect(msg).toContain("StartupCheckZeroConfig.world")
    })


    test(".http(api) called before .usePermissions(resolver) — start still throws for that route", async () => {
        // The resolver is captured per-.http() call, so calling http() before
        // usePermissions() leaves that schema with no resolver wired. Strict
        // mode is triggered by the declaration and the orphan-resolver check
        // catches the misconfiguration.
        const e = await expectStartToThrow(StartupCheckOrderRuntime)
        expect(e.message).toContain("StartupCheckBad.needsScope")
    })
})
