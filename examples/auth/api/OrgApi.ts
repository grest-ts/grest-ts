import {GGRpc, httpSchema} from "@grest-ts/http"
import {FORBIDDEN, GGContractClass, IsArray, IsNumber, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {USER_TOKEN_WIRE} from "./auth/UserAuth"
import {IsOrg, IsOrgId, ORG_TOKEN_WIRE, OrgPermission} from "./auth/OrgAuth"

export const IsSelectOrgRequest = IsObject({
    orgId: IsOrgId,
})
export type SelectOrgRequest = typeof IsSelectOrgRequest.infer

export const IsSelectOrgResponse = IsObject({
    orgToken: IsString.docs({title: "Org access token (JWT)", description: "Pass as x-org-token header"}),
    orgTokenExpiresAt: IsNumber.docs({title: "Org token expiry (ms epoch)"}),
    org: IsOrg,
})
export type SelectOrgResponse = typeof IsSelectOrgResponse.infer

export const OrgApiContract = new GGContractClass("OrgApi", {
    // Lists orgs the signed-in user belongs to. User auth only.
    listOrgs: {
        success: IsArray(IsOrg),
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    // Issues a short-lived org access token. User auth only.
    selectOrg: {
        input: IsSelectOrgRequest,
        success: IsSelectOrgResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    // Returns details of the currently selected org. Requires ORG_MEMBER (from org token).
    orgInfo: {
        success: IsOrg,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: OrgPermission.ORG_MEMBER,
    },
})

export const OrgApi = httpSchema(OrgApiContract)
    .pathPrefix("api/orgs")
    .use(USER_TOKEN_WIRE)
    .use(ORG_TOKEN_WIRE)
    .routes({
        listOrgs: GGRpc.GET("list"),
        selectOrg: GGRpc.POST("select"),
        orgInfo: GGRpc.GET("info"),
    })
