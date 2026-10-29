import {GGAuthority, GGHttpSchema, GGRpc} from "@grest-ts/http"
import {byField, FORBIDDEN, GGContractClass, type GGRequirement, type GGRequirementResource, IsArray, IsDiscriminated, IsLiteral, IsObject, IsString, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema"
import {USER_TOKEN_WIRE, WirePermission} from "./WireAuthApi"

// What a model library's builders would produce: data only, so the contract stays browser-safe.
const ERRORS = [NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND] as const
type Errors = typeof ERRORS[number]
const on = <const F extends string>(action: string, type: string, field: F, extra?: {hidden?: true, createOn?: GGRequirementResource<F>}): GGRequirement<F, Errors> =>
    Object.freeze({__permission: "requirement", action, resource: {type, id: {field}}, errors: ERRORS, ...extra})
const list = (action: string): GGRequirement<string, Errors> => Object.freeze({__permission: "requirement", action, list: true, errors: ERRORS})

export const DOCS_AUTHORITY = new GGAuthority("docs")

const IsPlace = IsDiscriminated("type", {
    desk: IsObject({type: IsLiteral("desk")}),
    folder: IsObject({type: IsLiteral("folder"), folderId: IsString}),
})
const PlaceAccess = byField(IsPlace, "type", {desk: null, folder: on("docs:Write", "docs:folder", "folderId")})

export const RequirementDocsApiContract = new GGContractClass("RequirementDocsApi", {
    read: {
        input: IsObject({docId: IsString}),
        success: IsString,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: on("docs:Read", "docs:doc", "docId", {hidden: true}),
    },
    publish: {
        input: IsObject({docId: IsString, text: IsString.nonEmpty}),
        success: IsString,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: {allOf: [WirePermission.ADMIN, on("docs:Write", "docs:doc", "docId")]},
    },
    save: {
        input: IsObject({docId: IsString.orUndefined, folderId: IsString}),
        success: IsString,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: on("docs:Write", "docs:doc", "docId", {createOn: {type: "docs:folder", id: {field: "folderId"}}}),
    },
    file: {
        input: IsObject({docId: IsString, place: IsPlace}),
        success: IsString,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: {allOf: [on("docs:Write", "docs:doc", "docId"), PlaceAccess.at("place")]},
    },
    list: {
        success: IsArray(IsString),
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: list("docs:Read"),
    },
})

export const RequirementDocsApi = new GGHttpSchema({
    contract: RequirementDocsApiContract,
    pathPrefix: "api/requirement-docs",
    use: [USER_TOKEN_WIRE, DOCS_AUTHORITY],
    routes: {
        read: GGRpc.GET("read"),
        publish: GGRpc.POST("publish"),
        save: GGRpc.POST("save"),
        file: GGRpc.POST("file"),
        list: GGRpc.GET("list"),
    },
})
