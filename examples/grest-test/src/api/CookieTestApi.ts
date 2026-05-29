import {GGRpc, httpSchema, cookie} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {GGContractClass, GG_NO_PERMISSIONS, IsBoolean, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

// A plain context key, bound to a cookie via cookie(SESSION). Read via .get(); write via
// setCookie(SESSION, value, options?). The key's name ("session") is the cookie's wire name.
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
    .use(cookie(SESSION))
    .pathPrefix("cookie")
    .routes({
        login: GGRpc.POST("login").updatesCookie(SESSION),
        me: GGRpc.GET("me"),                                  // read-only -> no declaration
        logout: GGRpc.POST("logout").updatesCookie(SESSION),
        tamper: GGRpc.POST("tamper"),                         // writes without declaring -> SERVER_ERROR
    })
