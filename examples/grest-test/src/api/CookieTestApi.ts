import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {GGContractClass, GG_NO_PERMISSIONS, IsBoolean, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

// A standard context key — read via .get(), write via .set(value) on routes that declare .updatesCookie.
export const SESSION = new GGContextKey<string | undefined>("session", IsString.orUndefined)

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
    .useCookie(SESSION, "sid")
    .pathPrefix("cookie")
    .routes({
        login: GGRpc.POST("login").updatesCookie(SESSION),
        me: GGRpc.GET("me"),                                  // read-only -> no declaration
        logout: GGRpc.POST("logout").updatesCookie(SESSION),
        tamper: GGRpc.POST("tamper"),                         // writes without declaring -> SERVER_ERROR
    })
