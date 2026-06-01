import {FORBIDDEN, GGContractImplementation, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {GGAuthToken} from "@grest-ts/auth"
import {OrgApiContract, OrgScopedApiContract, SelectOrgRequest, SelectOrgResponse} from "../../../api/OrgApi"
import {Org} from "../../../api/auth/OrgAuth"
import {ORG_USER} from "../auth/OrgAuthHandler"
import {USER_DATA} from "../auth/UserAuthHandler"
import {OrgTable} from "../tables/OrgTable"

export class OrgService implements GGContractImplementation<typeof OrgApiContract["methods"]>,
    GGContractImplementation<typeof OrgScopedApiContract["methods"]> {
    private readonly table = new OrgTable()

    constructor(private readonly orgTokenEngine: GGAuthToken<Org>) {
    }

    public listOrgs = async (): Promise<Org[]> => {
        return this.table.getForUser(USER_DATA.get()!.username)
    }

    public selectOrg = async (request: SelectOrgRequest): Promise<SelectOrgResponse> => {
        const user = USER_DATA.get()!
        if (!this.table.getMemberOrgIds(user.username).includes(request.orgId)) {
            throw new FORBIDDEN({displayMessage: "Not a member of this org"})
        }
        const org = this.table.get(request.orgId)
        if (!org) throw new FORBIDDEN({displayMessage: "Org not found"})
        return {
            ...(await this.orgTokenEngine.issueAccess(user.id, org)),
            data: org
        }
    }

    public orgInfo = async (): Promise<Org> => {
        const org = this.table.get(ORG_USER.get()!.orgId)
        if (!org) throw new NOT_FOUND()
        return org
    }

    // Called by ORG_TOKEN_WIRE's server handler during process().
    public verifyOrgToken = async (token: string | undefined) => {
        if (!token) throw new NOT_AUTHORIZED({debugMessage: "Missing org token"})
        return await this.orgTokenEngine.verifyAccess(token)
    }
}
