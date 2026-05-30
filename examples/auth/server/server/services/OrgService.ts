import {FORBIDDEN, GGContractImplementation} from "@grest-ts/schema"
import {AuthToken} from "@grest-ts/auth"
import {OrgApiContract, SelectOrgRequest, SelectOrgResponse} from "../../../api/OrgApi"
import {OrgContext, OrgClaims, OrgPermission, tOrgId, Org} from "../../../api/auth/OrgAuth"
import {UserContext} from "../../../api/auth/UserAuth"
import {OrgTable} from "../tables/OrgTable"

export class OrgService implements GGContractImplementation<typeof OrgApiContract["methods"]> {
    private readonly table = new OrgTable()

    constructor(private readonly orgTokenEngine: AuthToken<OrgPermission, OrgClaims>) {}

    public listOrgs = async (): Promise<Org[]> => {
        return this.table.getForUser(UserContext.get()!.username)
    }

    public selectOrg = async (request: SelectOrgRequest): Promise<SelectOrgResponse> => {
        const user = UserContext.get()!
        if (!this.table.getMemberOrgIds(user.username).includes(request.orgId)) {
            throw new FORBIDDEN({displayMessage: "Not a member of this org"})
        }
        const org = this.table.get(request.orgId)
        if (!org) throw new FORBIDDEN({displayMessage: "Org not found"})
        const {accessToken, accessExpiresAt} = await this.orgTokenEngine.issueAccess(
            user.id,
            [OrgPermission.ORG_MEMBER],
            {orgId: request.orgId},
        )
        return {accessToken, accessExpiresAt, ...org}
    }

    public orgInfo = async (): Promise<Org> => {
        return OrgContext.get()!
    }

    public getOrgById(orgId: tOrgId): Org | undefined {
        return this.table.get(orgId)
    }
}
