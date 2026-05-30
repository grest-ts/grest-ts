import {GGRpc, httpSchema} from "@grest-ts/http"
import {FORBIDDEN, GGContractClass, IsNumber, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {USER_TOKEN_WIRE, UserPermission} from "./auth/UserAuth"

export const IsBannerState = IsObject({
    count: IsNumber.docs({title: "Total clicks by permitted users"}),
    username: IsString.docs({title: "Username of last clicker"}),
})
export type BannerState = typeof IsBannerState.infer

export const BannerApiContract = new GGContractClass("BannerApi", {
    // Returns current click count — anyone authenticated can read it.
    bannerStatus: {
        success: IsObject({count: IsNumber}),
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    // Increments click counter. Requires CAN_SEE_RED_BANNER.
    clickBanner: {
        success: IsBannerState,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: UserPermission.CAN_SEE_RED_BANNER,
    },
})

export const BannerApi = httpSchema(BannerApiContract)
    .pathPrefix("api/banner")
    .use(USER_TOKEN_WIRE)
    .routes({
        bannerStatus: GGRpc.GET("status"),
        clickBanner: GGRpc.POST("click"),
    })
