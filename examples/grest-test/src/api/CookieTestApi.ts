import {GGRpc, httpSchema, GGCookie} from "@grest-ts/http"
import {GGContractClass, GG_NO_PERMISSIONS, IsBoolean, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

// The session cookie IS its own context key. Write via GGCookie.setCookie(SESSION, …).
// Its name ("session") is the cookie name.
export const SESSION = new GGCookie("session")

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
