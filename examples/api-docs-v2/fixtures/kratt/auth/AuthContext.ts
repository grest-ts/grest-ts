import {GGContextKey, type GGInbound, type GGOutbound} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"

const IsUserToken = IsString.brand("UserToken")
type tUserToken = typeof IsUserToken.infer

const IsOrgToken = IsString.brand("OrgToken")
type tOrgToken = typeof IsOrgToken.infer

/**
 * Reads/writes Authorization: Bearer <token>. `headers` / `responseHeaders`
 * declared for CORS + OpenAPI (grest-ts 0.0.24 transport middleware contract).
 */
class UserTokenTransport extends GGContextKey<tUserToken> {
    readonly headers: Record<string, GGSchema<string | undefined>> = {"authorization": IsString.orUndefined}
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    update(outbound: GGOutbound): void {
        const token = GG_USER_TOKEN.get()
        if (token) {
            outbound.headers["authorization"] = `Bearer ${token}`
        }
    }

    parse(inbound: GGInbound): void {
        const authHeader = inbound.headers["authorization"]
        if (authHeader && authHeader.startsWith("Bearer ")) {
            GG_USER_TOKEN.set(authHeader.substring(7) as tUserToken)
        }
    }
}

/**
 * Reads/writes X-Org-Token: <token>.
 */
class OrgTokenTransport extends GGContextKey<tOrgToken> {
    readonly headers: Record<string, GGSchema<string | undefined>> = {"x-org-token": IsString.orUndefined}
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    update(outbound: GGOutbound): void {
        const token = GG_ORG_TOKEN.get()
        if (token) {
            outbound.headers["x-org-token"] = token
        }
    }

    parse(inbound: GGInbound): void {
        const orgHeader = inbound.headers["x-org-token"]
        if (orgHeader) {
            GG_ORG_TOKEN.set(orgHeader as tOrgToken)
        }
    }
}

export const GG_USER_TOKEN = new UserTokenTransport("userToken", IsUserToken)
export const GG_ORG_TOKEN = new OrgTokenTransport("orgToken", IsOrgToken)
