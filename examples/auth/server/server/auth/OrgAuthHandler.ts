import {GGContextKey} from "@grest-ts/context"
import {deepFreeze} from "@grest-ts/common"
import type {OrgService} from "../services/OrgService"
import {ORG_TOKEN_WIRE, IsOrgUser} from "../../../api/auth/OrgAuth"

// Durable principal — server-only. The membership (OrgUser), not the shared Org, owns the
// permissions. Maps straight from the verified token (orgId claim + permissions); org details are
// fetched on demand by handlers. Deep-frozen so it can't be mutated to escalate.
export const ORG_USER = new GGContextKey("orgUser", IsOrgUser)

// Org wire is required-or-throw wherever it's .use()d (only OrgScopedApi). No optional branch:
// if the org token is missing/invalid, verifyOrgToken throws and the request fails at the wire.
export const ORG_TOKEN_WIRE_HANDLER = ORG_TOKEN_WIRE.define((orgs: OrgService) => ({
    process: async () => {
        const payload = await orgs.verifyOrgToken(ORG_TOKEN_WIRE.get())
        ORG_USER.set(deepFreeze({orgId: payload.orgId, permissions: payload.permissions}))
    },
    permissions: async () => ORG_USER.get()!.permissions,
}))
