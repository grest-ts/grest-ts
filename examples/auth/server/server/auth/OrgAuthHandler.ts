import {GGContextKey} from "@grest-ts/context"
import {IsArray, NOT_AUTHORIZED} from "@grest-ts/schema"
import {ORG_TOKEN_WIRE, ORG_DATA, IsOrgPermission, OrgPermission} from "../../../api/auth/OrgAuth"
import {OrgService} from "../services/OrgService"

const ORG_PERMS = new GGContextKey<OrgPermission[]>("orgPerms", IsArray(IsOrgPermission))

// Org wire is required-or-throw wherever it's .use()d (only OrgScopedApi). No optional branch:
// if the org token is missing/invalid, process() throws and the request fails at the wire.
export const ORG_TOKEN_WIRE_HANDLER = ORG_TOKEN_WIRE.define((orgs: OrgService) => ({
    process: async () => {
        const payload = await orgs.verifyOrgToken(ORG_TOKEN_WIRE.get())
        const org = orgs.getOrgById(payload.orgId)
        if (!org) throw new NOT_AUTHORIZED({debugMessage: "Org not found"})
        ORG_DATA.set(org)
        ORG_PERMS.set(payload.permissions)
    },
    permissions: async () => ORG_PERMS.get()!,
}))
