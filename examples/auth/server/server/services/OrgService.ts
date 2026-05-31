import {FORBIDDEN, GGContractImplementation, NOT_AUTHORIZED} from "@grest-ts/schema"
import {AuthError, AuthToken} from "@grest-ts/auth"
import {OrgApiContract, SelectOrgRequest, SelectOrgResponse} from "../../../api/OrgApi"
import {OrgScopedApiContract} from "../../../api/OrgApi"
import {ORG_DATA, OrgClaims, OrgPermission, tOrgId, Org} from "../../../api/auth/OrgAuth"
import {USER_DATA} from "../../../api/auth/UserAuth"
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
        return ORG_DATA.get()!
    }

    public getOrgById(orgId: tOrgId): Org | undefined {
        return this.table.get(orgId)
    }

    // Called by ORG_TOKEN_WIRE's server handler during process().
    public verifyOrgToken = async (token: string | undefined) => {
        if (!token) throw new NOT_AUTHORIZED({debugMessage: "Missing org token"})
        try {
            return await this.orgTokenEngine.verifyAccess(token)
        } catch (err) {
            if (err instanceof AuthError) throw new NOT_AUTHORIZED({debugMessage: err.code})
            throw err
        }
    }
}
