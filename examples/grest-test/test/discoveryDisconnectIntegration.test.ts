/**
 * Integration test: a runtime dies violently in a real subprocess,
 * end-to-end across real IPC. The leader's discovery server must
 * evict the dead runtime's routes.
 *
 * The unit-level repro lives next to the framework code at
 * `packages/discovery/discovery-local/src/local/GGLocalDiscoveryServer.test.ts`.
 * This test exists to confirm the same behavior with a real runtime,
 * a real GGHttpServer registration, a real subprocess, and a real
 * SIGKILL — to catch any regression where the registration path
 * bypasses the cleanup wiring.
 *
 * Note on file structure: the runtime, the API contract, AND the
 * `describe` block all live here. `startIsolated` re-imports this
 * file in a fresh subprocess (that's how it spawns the runtime), and
 * in that context vitest globals are absent, so the describe call is
 * gated on `typeof describe !== 'undefined'`.
 */
import {GGRuntime} from "@grest-ts/runtime"
import {GGHttp, GGHttpServer, GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGContractClass, IsObject, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {callOn, GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"

// ---------------------------------------------------------
// Tiny API + runtime — only ever used by this test file.
// ---------------------------------------------------------

const IsCrashRequest = IsObject({})
const IsCrashResponse = IsObject({})

const CrashTestApiContract = new GGContractClass("CrashTestApi", {
    crashSelf: {
        input: IsCrashRequest,
        success: IsCrashResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

type ICrashTestApi = typeof CrashTestApiContract.infer

const CrashTestApi = new GGHttpSchema({
    contract: CrashTestApiContract,
    pathPrefix: "api/crash-test",
    routes: {
        crashSelf: GGRpc.POST("crash"),
    },
})

class CrashTestService implements ICrashTestApi {
    public async crashSelf(): Promise<{}> {
        // SIGKILL ourselves — unblockable, no cleanup runs, OS drops
        // the IPC websocket with TCP RST. Same shape as a remote
        // process being SIGKILLed externally. Scheduled on the next
        // tick so this method can return before the process dies (the
        // caller will get a connection error, which is expected).
        setImmediate(() => process.kill(process.pid, "SIGKILL"))
        return {}
    }
}

export class CrashTestRuntime extends GGRuntime {
    public static readonly NAME = "crashTest"

    protected compose(): void {
        new GGHttp(new GGHttpServer())
            .http(CrashTestApi, new CrashTestService())
    }
}

CrashTestRuntime.cli(import.meta.url).then()

// ---------------------------------------------------------
// The actual test. Skipped when this file is re-imported by
// startIsolated's subprocess (where `describe` is undefined).
// ---------------------------------------------------------

if (typeof describe !== "undefined") {
    describe("discovery — isolated subprocess crash evicts routes", () => {

        test("SIGKILL of an isolated runtime cleans up its registered routes", async () => {
            const runner = GG_TEST_RUNNER.get()
            const discoveryServer: any = runner.discoveryServer

            // Boot the crash runtime in a real subprocess. By the time
            // await returns, lifecycle start has run and the route is
            // registered with the leader (this test process).
            await GGTest.startIsolated(CrashTestRuntime)

            expect(discoveryServer.getRoute(CrashTestApi.contract.name)).toBeDefined()

            // Trigger the runtime to SIGKILL itself. The call won't
            // complete — the process dies before responding. Swallow
            // the inevitable connection error.
            const crashClient = callOn(CrashTestApi)
            await crashClient.crashSelf({}).catch(() => { /* expected */ })

            // Poll for cleanup. A fixed sleep is brittle under parallel
            // suite load (other tests competing for CPU can delay the
            // close-event delivery and the discovery-side cleanup tick).
            // Polling keeps the happy path fast while tolerating slow
            // CI machines.
            const deadline = Date.now() + 5000
            while (discoveryServer.getRoute(CrashTestApi.contract.name) !== undefined && Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 50))
            }

            expect(discoveryServer.getRoute(CrashTestApi.contract.name)).toBeUndefined()
        }, 30000)
    })
}
