import {GGRpc, httpSchema} from "@grest-ts/http"
import {FORBIDDEN, GGContractClass, IsArray, IsNumber, IsObject, IsString, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {USER_TOKEN_WIRE} from "./auth/UserAuth"
import {IsOrg, IsOrgId, ORG_TOKEN_WIRE, OrgPermission} from "./auth/OrgAuth"

export const IsSelectOrgRequest = IsObject({
    orgId: IsOrgId,
})
export type SelectOrgRequest = typeof IsSelectOrgRequest.infer

const IsOrgAccess = IsObject({
    token: IsString,
    expiresAt: IsNumber,
})

export const IsSelectOrgResponse = IsObject({
    access: IsOrgAccess,
    data: IsOrg,
})
export type SelectOrgResponse = typeof IsSelectOrgResponse.infer

// User-authed only. These mint / list orgs and CANNOT require the org token (you don't have
// one yet). Rule 1: a wire on a schema is required-or-throw, so org-scoped reads can't live
// here — they'd force an org token onto selectOrg, which is exactly what hands it out.
export const OrgApiContract = new GGContractClass("OrgApi", {
    listOrgs: {
        success: IsArray(IsOrg),
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    selectOrg: {
        input: IsSelectOrgRequest,
        success: IsSelectOrgResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const OrgApi = httpSchema(OrgApiContract)
    .pathPrefix("api/orgs")
    .use(USER_TOKEN_WIRE)
    .routes({
        listOrgs: GGRpc.GET("list"),
        selectOrg: GGRpc.POST("select"),
    })

// Org-scoped: requires BOTH the user token AND the org token (AND across sources). The
// `ORG_MEMBER` permission routes to ORG_TOKEN_WIRE; the user wire still authenticates.
export const OrgScopedApiContract = new GGContractClass("OrgScopedApi", {
    orgInfo: {
        success: IsOrg,
        errors: [NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, SERVER_ERROR],
        permission: OrgPermission.ORG_MEMBER,
    },
})

export const OrgScopedApi = httpSchema(OrgScopedApiContract)
    .pathPrefix("api/org")
    .use(USER_TOKEN_WIRE)
    .use(ORG_TOKEN_WIRE)
    .routes({
        orgInfo: GGRpc.GET("info"),
    })
