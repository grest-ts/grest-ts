import {GGRpc, httpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, IsArray, IsEnum, IsObject, IsString, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsBuildingId, IsTemplateId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
// ---------------------------------------------------------
// Type Schemas - IDs
// ---------------------------------------------------------

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum BuildingState {
    ACTIVE = "active",
    HIDDEN = "hidden"
}

const IsBuildingState = IsEnum(BuildingState)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsBuildingApiGetForSelectRequest = IsObject({
    id: IsBuildingId.orNull.orUndefined,
    search: IsString.orNull.orUndefined
}).orUndefined.default({})
export type BuildingApiGetForSelectRequest = typeof IsBuildingApiGetForSelectRequest.infer

export const IsBuildingRow = IsObject({
    id: IsBuildingId,
    name: IsString
})

export const IsBuildingApiGetForSelectResponse = IsObject({
    rows: IsArray(IsBuildingRow)
})
export type BuildingApiGetForSelectResponse = typeof IsBuildingApiGetForSelectResponse.infer

export const IsGetBuildingRequest = IsObject({
    id: IsBuildingId
})
export type GetBuildingRequest = typeof IsGetBuildingRequest.infer

export const IsSyncBuildingRow = IsObject({
    id: IsBuildingId.orNull.orUndefined,
    address: IsString,
    state: IsBuildingState,
    bookkeeperName: IsString.orNull,
    bookkeeperPhone: IsString.orNull,
    bookkeeperEmail: IsString.orNull,
    cooperativeName: IsString.orNull,
    cooperativePhone: IsString.orNull,
    cooperativeEmail: IsString.orNull,
    description: IsString.orNull,
    welcomeEmailTemplateId: IsTemplateId.orNull.orUndefined
})
export type SyncBuildingRow = typeof IsSyncBuildingRow.infer

export const IsSyncBuildingResult = IsObject({
    id: IsBuildingId
})
export type SyncBuildingResult = typeof IsSyncBuildingResult.infer

export const IsDeleteBuildingRequest = IsObject({
    id: IsBuildingId
})
export type DeleteBuildingRequest = typeof IsDeleteBuildingRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const BuildingApiContract = new GGContractClass("BuildingApi", {
    getForSelect: {
        input: IsBuildingApiGetForSelectRequest,
        success: IsBuildingApiGetForSelectResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sync: {
        input: IsSyncBuildingRow,
        success: IsSyncBuildingResult,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsGetBuildingRequest,
        success: IsSyncBuildingRow,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsDeleteBuildingRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const BuildingApi = httpSchema(BuildingApiContract)
    .pathPrefix("gg/building")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        getForSelect: GGRpc.POST("getForSelect"),
        sync: GGRpc.POST("sync"),
        get: GGRpc.POST("get"),
        delete: GGRpc.POST("delete")
    })

