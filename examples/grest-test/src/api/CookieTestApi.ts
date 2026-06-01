import {GGRpc, httpSchema, GGCookie} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {AppPermission} from "./PermissionsApi"
import {GGContractClass, GG_NO_PERMISSIONS, IsBoolean, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

// The session cookie IS its own context key. Write via GGCookie.setCookie(SESSION, …).
// Its name ("session") is the cookie name.
export const SESSION = new GGCookie("session")

// Durable session value + scopes minted in process(): the raw cookie is ephemeral and
// cleared before handlers run, so handlers read SESSION_VALUE and the gate reads the
// scopes derived here. process() does NOT throw on an absent cookie — CookieTestApi's
// public routes (me/tamper) serve cookie-less callers — so a missing session simply
// contributes no scopes, and connectPermission-gated WS handshakes fail closed (FORBIDDEN).
export const SESSION_VALUE = new GGContextKey<string | undefined>("session-value", IsString.orUndefined)

export const SESSION_HANDLER = SESSION.define(() => ({
    process: async () => {
        SESSION_VALUE.set(SESSION.get())
    },
    permissions: async () => {
        const session = SESSION_VALUE.get()
        if (!session) return []
        if (session.includes("admin")) return [AppPermission.Admin, AppPermission.Read]
        return [AppPermission.Read]
    },
}))

export const CookieTestContract = new GGContractClass("CookieTestApi", {
    login: {
        input: IsObject({user: IsString}),
        success: IsObject({ok: IsBoolean}),
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    me: {
        success: IsObject({session: IsString.orUndefined}),
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    logout: {
        success: IsObject({ok: IsBoolean}),
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    // Writes the cookie but its route does NOT declare .updatesCookie — proves the guard.
    tamper: {
        success: IsObject({ok: IsBoolean}),
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const CookieTestApi = httpSchema(CookieTestContract)
    .use(SESSION)
    .pathPrefix("cookie")
    .routes({
        login: GGRpc.POST("login").updatesCookie(SESSION),
        me: GGRpc.GET("me"),                                  // read-only -> no declaration
        logout: GGRpc.POST("logout").updatesCookie(SESSION),
        tamper: GGRpc.POST("tamper"),                         // writes without declaring -> SERVER_ERROR
    })
