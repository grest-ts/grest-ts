import {GGContextKey} from "@grest-ts/context"
import type {GGHttpRequest} from "@grest-ts/http"
import {GGContractClass, IsObject, IsString, IsNumber, SERVER_ERROR, type GGSchema, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {NOT_FOUND, UNAUTHORIZED} from "./errors"
import {IsTaskId} from "./schemas"

/**
 * Internal resolver endpoint used by the hosting proxy.
 *
 * Called on every cache miss while routing a browser request. The hosting
 * proxy extracts the taskId from the Host header, calls this endpoint,
 * and forwards the request to `{vmIp}:{relayProxyPort}`.
 *
 * Authentication is a shared secret passed in the `X-Hosting-Proxy-Secret`
 * header. This endpoint is internal — it must not be exposed to public
 * traffic. In dev both processes run on the same machine so the secret
 * can be a stable dev-only value; in prod it's injected as a secret on
 * both sides from the same source.
 */

const IsHostingProxySecret = IsString.brand("HostingProxySecret")
type tHostingProxySecret = typeof IsHostingProxySecret.infer

/**
 * Transport for `X-Hosting-Proxy-Secret` header. Used by both the
 * hosting-proxy client (sets the header) and hub-server (reads it).
 */
class HostingProxySecretTransport extends GGContextKey<tHostingProxySecret> {
    readonly headers: Record<string, GGSchema<string | undefined>> = {"x-hosting-proxy-secret": IsString.orUndefined}
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    updateRequest(req: GGHttpRequest): void {
        const secret = GG_HOSTING_PROXY_SECRET.get()
        if (secret) {
            req.headers = req.headers ?? {}
            req.headers["x-hosting-proxy-secret"] = secret
        }
    }

    parseRequest(req: GGHttpRequest): void {
        const header = req.headers?.["x-hosting-proxy-secret"]
        if (header && typeof header === "string") {
            GG_HOSTING_PROXY_SECRET.set(header as tHostingProxySecret)
        }
    }
}

export const GG_HOSTING_PROXY_SECRET = new HostingProxySecretTransport("hostingProxySecret", IsHostingProxySecret)

const IsResolveRequest = IsObject({
    taskId: IsTaskId,
})

const IsResolveResponse = IsObject({
    /** VM IP the hosting proxy should forward to. */
    vmIp: IsString,
    /** Port on the VM where relay's VM proxy is listening. */
    relayProxyPort: IsNumber,
    /** SHA-256 fingerprint (lowercase hex, no colons) of the VM's relay TLS
     *  cert. Hosting proxy pins this when opening its HTTPS connection to
     *  the VM — both :9600 (relay API) and :9601 (vmProxy) use the same
     *  cert. See ARCHITECTURE.md "Certificate lifecycle". */
    certFingerprint: IsString,
})

export const HostingResolveApiContract = new GGContractClass("HostingResolveApi", {
    resolve: {
        input: IsResolveRequest,
        success: IsResolveResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const HostingResolveApi = httpSchema(HostingResolveApiContract)
    .pathPrefix("internal")
    .use(GG_HOSTING_PROXY_SECRET)
    .routes({
        resolve: GGRpc.POST("hosting/resolve"),
    })
