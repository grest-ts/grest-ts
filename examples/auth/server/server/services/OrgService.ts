import {FORBIDDEN, GGContractImplementation, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {AuthToken} from "@grest-ts/auth"
import {OrgApiContract, SelectOrgRequest, SelectOrgResponse} from "../../../api/OrgApi"
import {OrgScopedApiContract} from "../../../api/OrgApi"
import {OrgClaims, OrgPermission, Org} from "../../../api/auth/OrgAuth"
import {ORG_USER} from "../auth/OrgAuthHandler"
import {USER_DATA} from "../auth/UserAuthHandler"
import {OrgTable} from "../tables/OrgTable"

export class OrgService implements GGContractImplementation<typeof OrgApiContract["methods"]>,
    GGContractImplementation<typeof OrgScopedApiContract["methods"]> {
    private readonly table = new OrgTable()

    constructor(private readonly orgTokenEngine: AuthToken<OrgPermission, OrgClaims>) {}

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
        const {access} = await this.orgTokenEngine.issueAccess(user.id, [OrgPermission.ORG_MEMBER], {orgId: request.orgId})
        return {access, data: org}
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
