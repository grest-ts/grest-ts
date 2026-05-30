import {GGTestContext} from "@grest-ts/testkit"
import "@grest-ts/http/testkit"
import {GG_USER_AUTH_TOKEN, tUserAuthToken} from "../common/api/auth/UserAuth"
import {AuthPublicApi, LoginRequest, RegisterRequest} from "../common/api/AuthPublicApi"
import {Raw} from "@grest-ts/schema"

export class TestContext extends GGTestContext {
    public async register(data: Raw<RegisterRequest>) {
        const result = await this.callOn(AuthPublicApi).register(data)
        this.setLoggedIn(result.token)
    }

    public async login(data: Raw<LoginRequest>) {
        const result = await this.callOn(AuthPublicApi).login(data)
        this.setLoggedIn(result.token)
    }

    public setLoggedIn(token: tUserAuthToken) {
        this.set(GG_USER_AUTH_TOKEN, token)
    }
}
