import {randomBytes} from "node:crypto"
import {GGHttpInterceptorsServer} from "@grest-ts/http/testkit"
import {GGLog} from "@grest-ts/logger"
import {type GGTestComponent, GGTestRunner} from "@grest-ts/testkit"
import {GGOAuthServiceApi} from "../src/node/GGOAuthServiceApi"
import {GGOAuthTestIPC} from "./GGOAuthTestCommands"

// While no GGOAuthServer runs in the test, service tokens are random placeholders that expire at once,
// so GGOAuthServiceClient never reuses one. A mocked API accepts any token; a real one refuses them.
export class GGOAuthTestTokens implements GGTestComponent {

    private readonly runner: GGTestRunner
    private announced = false

    constructor(runner: GGTestRunner) {
        this.runner = runner
    }

    public async start(): Promise<void> {
        this.runner.getExtensionInstance(GGHttpInterceptorsServer).addDefault(GGOAuthServiceApi, {token: this.placeholder, exchange: this.placeholder})
    }

    public async beforeEach(): Promise<void> {
        this.announced = false
        await this.runner.sendCommand(GGOAuthTestIPC.worker.forgetTokens, undefined)
    }

    // Once per test: test output groups logs by test.
    private placeholder = async () => {
        if (!this.announced) {
            this.announced = true
            GGLog.info(this, "No GGOAuthServer runs in this test, so service tokens are placeholders. Mocked APIs accept them; " +
                "a real API refuses them with NOT_AUTHORIZED. For real tokens, start the runtime that mounts GGOAuthServer.")
        }
        return {token: `gg-test-token-${randomBytes(16).toString("base64url")}`, expiresAt: Date.now()}
    }
}

GGTestRunner.registerExtension(GGOAuthTestTokens)
