import {GGTestContext} from "@grest-ts/testkit"
import "@grest-ts/http/testkit"
import {USER_TOKEN_WIRE} from "../../api/auth/UserAuth"
import {ORG_TOKEN_WIRE} from "../../api/auth/OrgAuth"
import {AuthPublicApi, LoginRequest, RegisterRequest} from "../../api/AuthPublicApi"
import {Raw} from "@grest-ts/schema"

export class TestContext extends GGTestContext {
    public async register(data: Raw<RegisterRequest>) {
        const result = await this.callOn(AuthPublicApi).register(data)
        this.setLoggedIn(result.tokens.access.token)
    }

    public async login(data: Raw<LoginRequest>) {
        const result = await this.callOn(AuthPublicApi).login(data)
        this.setLoggedIn(result.tokens.access.token)
    }

    // Test affordance: inject a fixed outbound value for the wire directly, bypassing the
    // defineClient value()/recover() path. The wire attaches it as `Authorization: Bearer`.
    public setLoggedIn(accessToken: string) {
        this.set(USER_TOKEN_WIRE, accessToken)
    }

    public setOrgToken(orgToken: string) {
        this.set(ORG_TOKEN_WIRE, orgToken)
    }

    public clearOrgToken() {
        this.set(ORG_TOKEN_WIRE, undefined)
    }
}
