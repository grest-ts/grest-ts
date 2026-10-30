import {randomBytes} from "node:crypto"
import {GGHttpInterceptorsServer} from "@grest-ts/http/testkit"
import {GGLog} from "@grest-ts/logger"
import {type GGTestComponent, GGTestRunner} from "@grest-ts/testkit"
import {GGOAuthServiceApi} from "../src/node/GGOAuthServiceApi"

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

    private placeholder = async () => {
        if (!this.announced) {
            this.announced = true
            GGLog.info(this, "No GGOAuthServer is running in this test: service tokens are placeholders, accepted only by mocked APIs")
        }
        return {token: `gg-test-token-${randomBytes(16).toString("base64url")}`, expiresAt: Date.now()}
    }
}

GGTestRunner.registerExtension(GGOAuthTestTokens)
