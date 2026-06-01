import {GGHeader} from "@grest-ts/http"
import {IsArray, IsEnum, IsObject, IsString} from "@grest-ts/schema"

// Org permissions, carried on the durable org membership principal.
export enum OrgPermission {
    ORG_MEMBER = "ORG_MEMBER",
}
export const IsOrgPermission = IsEnum(OrgPermission)

// Claims carried inside the org JWT alongside permissions.
export interface OrgClaims {
    orgId: tOrgId
}

export const IsOrgId = IsString.brand("OrgId")
export type tOrgId = typeof IsOrgId.infer

export const IsOrg = IsObject({
    id: IsOrgId,
    name: IsString,
    description: IsString
})
export type Org = typeof IsOrg.infer

// The user's membership in an org. An Org doesn't own permissions; an OrgUser does — ORG_MEMBER
// is scoped to this membership. Holds orgId (not the org snapshot — org details are fetched fresh).
export const IsOrgUser = IsObject({
    orgId: IsOrgId,
    permissions: IsArray(IsOrgPermission),
})
export type OrgUser = typeof IsOrgUser.infer

// SMART wire: parses `x-org-token: <jwt>` (no bearer scheme — a custom header). Like the user
// wire it is required-or-throw on any schema that .use()s it — which is why org-scoped routes
// live on their own schema (OrgScopedApi), separate from the routes that mint the org token.
export const ORG_TOKEN_WIRE = new GGHeader("x-org-token", {})
