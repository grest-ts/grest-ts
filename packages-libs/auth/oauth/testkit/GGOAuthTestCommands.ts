import {IPCClient} from "@grest-ts/ipc"
import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit"
import {GGOAuthServiceClient} from "../src/node/GGOAuthServiceClient"

export const GGOAuthTestIPC = {
    worker: {
        forgetTokens: IPCClient.defineRequest<void, void>("oauth.forgetTokens"),
    }
}

interface TokenCache {
    tokens: Map<string, unknown>
    cachedToken(resource: string): Promise<string>
}

// Each test starts without cached service tokens: one a test mocked (or a real server issued) must not
// answer the next test's calls, or that test's own token mock is never reached.
let generation = 0
const seen = new WeakMap<object, number>()
const prototype = GGOAuthServiceClient.prototype as unknown as TokenCache
const cachedToken = prototype.cachedToken
prototype.cachedToken = function (this: TokenCache, resource: string) {
    if (seen.get(this) !== generation) {
        this.tokens.clear()
        seen.set(this, generation)
    }
    return cachedToken.call(this, resource)
}

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    GG_TEST_RUNTIME_WORKER.get().ipcClient.onFrameworkRequest(GGOAuthTestIPC.worker.forgetTokens, async () => {
        generation++
    })
})
