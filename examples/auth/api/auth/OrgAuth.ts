import {GGHeader} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {IsEnum, IsObject, IsString} from "@grest-ts/schema"

// Raw org token context key — populated by ORG_TOKEN_WIRE when parsing x-org-token header.
export const ORG_TOKEN = new GGContextKey<string | undefined>("org", IsString.orUndefined)

// Wire binding — attach to API schemas with .use(ORG_TOKEN_WIRE).
export const ORG_TOKEN_WIRE = GGHeader.middleware(ORG_TOKEN, {name: "x-org-token"})

// Permissions embedded in an org access token when the user selects an org.
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
    description: IsString,
})
export type Org = typeof IsOrg.infer

// Set by OrgContextMiddleware when an org token is present.
export const OrgContext = new GGContextKey<Org>("orgData", IsOrg)
