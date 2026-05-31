import {GGContextKey} from "@grest-ts/context"
import {deepFreeze} from "@grest-ts/common"
import {IsArray, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {IsOrgWirePermission, IsWireUser, ORG_TOKEN_WIRE, OrgWirePermission, USER_TOKEN_WIRE, WirePermission, WireUser} from "./api/WireAuthApi"

// Durable principal — server-only, minted inside process() and deep-frozen so a handler
// can't mutate permissions to escalate.
export const USER_DATA = new GGContextKey("wireTestUserData", IsWireUser)

const USERS: Record<string, WireUser> = {
    alice: {id: "u-alice", username: "alice", permissions: [WirePermission.ADMIN]},
    bob: {id: "u-bob", username: "bob", permissions: []},
}

export class WireUserService {
    public verify(token: string | undefined): WireUser {
        if (!token) throw new NOT_AUTHORIZED({debugMessage: "Missing bearer token"})
        const user = USERS[token]
        if (!user) throw new NOT_AUTHORIZED({debugMessage: "Unknown token"})
        return user
    }

    public me = async (): Promise<WireUser> => USER_DATA.get()!
    public adminOnly = async (): Promise<string> => `admin-ok:${USER_DATA.get()!.username}`
    public echoToken = async (): Promise<string> => USER_TOKEN_WIRE.get() ?? "CLEARED"
}

export class WirePublicService {
    public ping = async (): Promise<string> => "pong"
}

export const USER_TOKEN_WIRE_HANDLER = USER_TOKEN_WIRE.define((users: WireUserService) => ({
    process: async () => {
        USER_DATA.set(deepFreeze(users.verify(USER_TOKEN_WIRE.get())))
    },
    permissions: async () => USER_DATA.get()!.permissions,
}))

// ---- org wire (second source) ----------------------------------------------------------------
const IsOrgMembership = IsObject({orgId: IsString, permissions: IsArray(IsOrgWirePermission)})
export const ORG_USER = new GGContextKey("wireTestOrgUser", IsOrgMembership)

export class WireOrgService {
    // The "token" is just the orgId; any present token grants ORG_MEMBER for that org.
    public verify(token: string | undefined): {orgId: string; permissions: OrgWirePermission[]} {
        if (!token) throw new NOT_AUTHORIZED({debugMessage: "Missing org token"})
        return {orgId: token, permissions: [OrgWirePermission.ORG_MEMBER]}
    }

    public orgInfo = async (): Promise<string> => `org:${ORG_USER.get()!.orgId}`
}

export const ORG_TOKEN_WIRE_HANDLER = ORG_TOKEN_WIRE.define((orgs: WireOrgService) => ({
    process: async () => {
        ORG_USER.set(deepFreeze(orgs.verify(ORG_TOKEN_WIRE.get())))
    },
    permissions: async () => ORG_USER.get()!.permissions,
}))
