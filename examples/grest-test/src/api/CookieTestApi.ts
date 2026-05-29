import {GGCookie, GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, GG_NO_PERMISSIONS, IsBoolean, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

export const SESSION = new GGCookie("sid")

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
    // Intentionally does NOT declare .setsCookies — used to prove the strict guard.
    badIssue: {
        success: IsObject({ok: IsBoolean}),
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const CookieTestApi = httpSchema(CookieTestContract)
    .use(SESSION)
    .pathPrefix("cookie")
    .routes({
        login: GGRpc.POST("login").setsCookies(SESSION),
        me: GGRpc.GET("me"),
        logout: GGRpc.POST("logout").setsCookies(SESSION),
        badIssue: GGRpc.POST("bad-issue"),
    })
