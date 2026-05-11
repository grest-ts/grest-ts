import {GGContractClass, IsObject, IsString, IsNumber, IsLiteral, IsArray, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND, NAME_TAKEN} from "./errors"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"
import {IsBaseImageId} from "./schemas"

/**
 * BaseImage — generic, Kratt-provided VM snapshot that project images layer on
 * top of. Globally scoped (no orgId). Build/delete require user.root.
 * Auto-versioned as `kratt-base-<provider>-v<N>`.
 */
export const IsBaseImage = IsObject({
    baseImageId: IsBaseImageId,
    name: IsString,
    provider: IsLiteral("multipass", "hetzner"),
    providerImageId: IsString.orUndefined,
    status: IsLiteral("building", "ready", "failed", "missing"),
    buildProgress: IsString.orUndefined,
    buildProgressTotal: IsNumber.orUndefined,
    buildProgressCompleted: IsNumber.orUndefined,
    buildProgressStartedAt: IsNumber.orUndefined,
    buildLog: IsString.orUndefined,
    builtAt: IsNumber.orUndefined,
    error: IsString.orUndefined,
    /** Monotonic per-entity version, bumped on every write. Clients use it
     *  to drop stale events and detect gaps. Existing pre-versioning
     *  records read as 0; the first write brings them to 1. */
    version: IsNumber,
})

export type BaseImage = typeof IsBaseImage.infer

const IsBuildBaseImageRequest = IsObject({
    provider: IsLiteral("multipass", "hetzner"),
})

const IsBaseImageIdRequest = IsObject({
    baseImageId: IsBaseImageId,
})

const IsBaseImageResponse = IsObject({baseImage: IsBaseImage})

export const BaseImageApiContract = new GGContractClass("BaseImageApi", {
    list: {
        success: IsArray(IsBaseImage),
        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsBaseImageIdRequest,
        success: IsBaseImage,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    build: {
        input: IsBuildBaseImageRequest,
        success: IsBaseImageResponse,
        errors: [UNAUTHORIZED, NAME_TAKEN, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsBaseImageIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const BaseImageApi = httpSchema(BaseImageApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        list: GGRpc.GET("base-images"),
        get: GGRpc.POST("base-images/get"),
        build: GGRpc.POST("base-images/build"),
        delete: GGRpc.POST("base-images/delete"),
    })
