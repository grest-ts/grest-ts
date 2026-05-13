import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, IsBoolean, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {InternalAuthUse} from "./auth/InternalAuthUse";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsBlockCheckRequest = IsObject({
    username: IsString
})
export type BlockCheckRequest = typeof IsBlockCheckRequest.infer

export const IsBlockCheckResponse = IsObject({
    blocked: IsBoolean,
    reason: IsString.orUndefined
})
export type BlockCheckResponse = typeof IsBlockCheckResponse.infer

export const IsBlockUserRequest = IsObject({
    username: IsString,
    reason: IsString.orUndefined
})
export type BlockUserRequest = typeof IsBlockUserRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const BlockerApiContract = new GGContractClass("BlockerApi", {
    checkBlock: {
        input: IsBlockCheckRequest,
        success: IsBlockCheckResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    blockUser: {
        input: IsBlockUserRequest,
        success: undefined as undefined,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const BlockerApi = httpSchema(BlockerApiContract)
    .pathPrefix("blocker")
    .use(InternalAuthUse)
    .routes({
        checkBlock: GGRpc.POST("checkBlock"),
        blockUser: GGRpc.POST("blockUser")
    })
