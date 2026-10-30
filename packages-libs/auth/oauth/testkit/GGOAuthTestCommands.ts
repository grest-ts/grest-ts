import {IPCClient} from "@grest-ts/ipc"
import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit"
import {GGOAuthServiceClient} from "../src/node/GGOAuthServiceClient"

export const GGOAuthTestIPC = {
    worker: {
        forgetTokens: IPCClient.defineRequest<void, void>("oauth.forgetTokens"),
    }
}

// Each test starts without cached service tokens: one a test mocked (or a real server issued) must not
// answer the next test's calls, or that test's own token mock is never reached.
let generation = 0
const seen = new WeakMap<GGOAuthServiceClient, number>()
const token = GGOAuthServiceClient.prototype.token
GGOAuthServiceClient.prototype.token = function (this: GGOAuthServiceClient, resource: string): Promise<string> {
    if (seen.get(this) !== generation) {
        this._tokens.clear()
        seen.set(this, generation)
    }
    return token.call(this, resource)
}

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    GG_TEST_RUNTIME_WORKER.get().ipcClient.onFrameworkRequest(GGOAuthTestIPC.worker.forgetTokens, async () => {
        generation++
    })
})
