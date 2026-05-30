import {FORBIDDEN, GGContractImplementation} from "@grest-ts/schema"
import {AuthToken} from "@grest-ts/auth"
import {OrgApiContract, SelectOrgRequest, SelectOrgResponse} from "../../../api/OrgApi"
import {OrgContext, OrgClaims, OrgPermission, tOrgId, Org} from "../../../api/auth/OrgAuth"
import {UserContext, tUserId} from "../../../api/auth/UserAuth"

interface OrgRecord extends Org {
    memberIds: tUserId[]
}

// Seed orgs and memberships.
const SEED_ORGS: OrgRecord[] = [
    {id: "org-1" as tOrgId, name: "Acme Corp", description: "Main organization", memberIds: [] as tUserId[]},
    {id: "org-2" as tOrgId, name: "Beta Labs", description: "R&D organization", memberIds: [] as tUserId[]},
]
const SEED_MEMBERSHIPS: Record<string, tOrgId[]> = {
    alice: ["org-1" as tOrgId, "org-2" as tOrgId],
    carol: ["org-1" as tOrgId, "org-2" as tOrgId],
    bob:   ["org-1" as tOrgId],
}

export class OrgService implements GGContractImplementation<typeof OrgApiContract["methods"]> {
    private readonly orgs = new Map<tOrgId, OrgRecord>(SEED_ORGS.map(o => [o.id, o]))
    // userId → set of orgIds


    constructor(private readonly orgTokenEngine: AuthToken<OrgPermission, OrgClaims>) {}

    // Called by auth.ts to seed memberships keyed by userId after users register.
    // For this demo we seed by username; runtime lookup done on listOrgs.
    getMemberOrgIds(username: string): tOrgId[] {
        return SEED_MEMBERSHIPS[username] ?? []
    }

    public listOrgs = async (): Promise<Org[]> => {
        const user = UserContext.get()!
        const orgIds = this.getMemberOrgIds(user.username)
        return orgIds.flatMap(id => {
            const org = this.orgs.get(id)
            return org ? [{id: org.id, name: org.name, description: org.description}] : []
        })
    }

    public selectOrg = async (request: SelectOrgRequest): Promise<SelectOrgResponse> => {
        const user = UserContext.get()!
        const memberOrgIds = this.getMemberOrgIds(user.username)
        if (!memberOrgIds.includes(request.orgId)) throw new FORBIDDEN({displayMessage: "Not a member of this org"})
        const org = this.orgs.get(request.orgId)
        if (!org) throw new FORBIDDEN({displayMessage: "Org not found"})
        const {accessToken: orgToken} = await this.orgTokenEngine.issueAccess(
            user.id,
            [OrgPermission.ORG_MEMBER],
            {orgId: request.orgId},
        )
        return {orgToken, org: {id: org.id, name: org.name, description: org.description}}
    }

    public orgInfo = async (): Promise<Org> => {
        // OrgContext is set by OrgContextMiddleware when org token is present.
        return OrgContext.get()!
    }

    public getOrgById(orgId: tOrgId): Org | undefined {
        const r = this.orgs.get(orgId)
        return r ? {id: r.id, name: r.name, description: r.description} : undefined
    }
}
