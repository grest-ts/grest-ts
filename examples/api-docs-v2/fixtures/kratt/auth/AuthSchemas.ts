import {IsObject, IsString, IsBoolean} from "@grest-ts/schema"
import {IsOrgId, IsUserId} from "../hub/schemas"

export const IsUserTokenPayload = IsObject({
    userId: IsUserId,
    username: IsString,
    root: IsBoolean.orUndefined,
})

export type UserTokenPayload = typeof IsUserTokenPayload.infer

export const IsOrgTokenPayload = IsObject({
    orgId: IsOrgId,
    orgName: IsString,
    userId: IsUserId,
    permissions: IsString,
})

export type OrgTokenPayload = typeof IsOrgTokenPayload.infer
