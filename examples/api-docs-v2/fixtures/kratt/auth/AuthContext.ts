import {GGContextKey} from "@grest-ts/context"
import type {GGHttpRequest} from "@grest-ts/http"
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

    updateRequest(req: GGHttpRequest): void {
        const token = GG_USER_TOKEN.get()
        if (token) {
            req.headers = req.headers ?? {}
            req.headers["authorization"] = `Bearer ${token}`
        }
    }

    parseRequest(req: GGHttpRequest): void {
        const authHeader = req.headers?.["authorization"]
        if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
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

    updateRequest(req: GGHttpRequest): void {
        const token = GG_ORG_TOKEN.get()
        if (token) {
            req.headers = req.headers ?? {}
            req.headers["x-org-token"] = token
        }
    }

    parseRequest(req: GGHttpRequest): void {
        const orgHeader = req.headers?.["x-org-token"]
        if (orgHeader && typeof orgHeader === "string") {
            GG_ORG_TOKEN.set(orgHeader as tOrgToken)
        }
    }
}

export const GG_USER_TOKEN = new UserTokenTransport("userToken", IsUserToken)
export const GG_ORG_TOKEN = new OrgTokenTransport("orgToken", IsOrgToken)
