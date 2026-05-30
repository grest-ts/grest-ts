import {tOrgId, Org} from "../../../api/auth/OrgAuth"
import {tUserId} from "../../../api/auth/UserAuth"

export interface OrgRecord extends Org {
    memberIds: tUserId[]
}

const SEED_ORGS: OrgRecord[] = [
    {id: "org-1" as tOrgId, name: "Acme Corp", description: "Main organization", memberIds: [] as tUserId[]},
    {id: "org-2" as tOrgId, name: "Beta Labs", description: "R&D organization", memberIds: [] as tUserId[]},
]

const SEED_MEMBERSHIPS: Record<string, tOrgId[]> = {
    alice: ["org-1" as tOrgId, "org-2" as tOrgId],
    carol: ["org-1" as tOrgId, "org-2" as tOrgId],
    bob:   ["org-1" as tOrgId],
}

export class OrgTable {
    private readonly orgs = new Map<tOrgId, OrgRecord>(SEED_ORGS.map(o => [o.id, {...o}]))

    public getMemberOrgIds(username: string): tOrgId[] {
        return SEED_MEMBERSHIPS[username] ?? []
    }

    public getForUser(username: string): Org[] {
        return this.getMemberOrgIds(username).flatMap(id => {
            const org = this.orgs.get(id)
            return org ? [{id: org.id, name: org.name, description: org.description}] : []
        })
    }

    public get(id: tOrgId): Org | undefined {
        const r = this.orgs.get(id)
        return r ? {id: r.id, name: r.name, description: r.description} : undefined
    }
}
