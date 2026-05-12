import {callOn, GGTest} from "@grest-ts/testkit"
import {StartupCheckZeroConfigRuntime} from "../src/StartupCheckZeroConfigRuntime"
import {StartupCheckZeroConfigApi} from "../src/api/StartupCheckBadApi"

/**
 * Verifies the per-request HTTP gate passes traffic straight through to the
 * handler when `permission` is undefined on the route — i.e. the zero-config
 * case where strict mode is never triggered. Kept in its own file so the
 * per-test startInline runtimes in permissions-startup.test.ts don't compete
 * with this file's describe-level inline runtime.
 */
describe("permissions / zero-config request path", () => {

    GGTest.startInline(StartupCheckZeroConfigRuntime)

    test("zero-config server serves traffic without any permission check", async () => {
        const client = callOn(StartupCheckZeroConfigApi)
        expect(await client.hello()).toBe("hello")
        expect(await client.world()).toBe("world")
    })
})
