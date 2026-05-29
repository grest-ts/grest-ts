import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {GGContractClass, GG_NO_PERMISSIONS, IsBoolean, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

// A standard context key — read via .get(), mint via .set(value), clear via .set(undefined).
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
})

export const CookieTestApi = httpSchema(CookieTestContract)
    .useCookie(SESSION, {cookieName: "sid", maxAgeSec: 3600})
    .pathPrefix("cookie")
    .routes({
        login: GGRpc.POST("login"),
        me: GGRpc.GET("me"),
        logout: GGRpc.POST("logout"),
    })
