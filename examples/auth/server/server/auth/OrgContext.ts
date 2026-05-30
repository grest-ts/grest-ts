import {GGTransportMiddleware} from "@grest-ts/context"
import {AuthGuard} from "@grest-ts/auth"
import {OrgContext, OrgClaims, OrgPermission} from "../../../api/auth/OrgAuth"
import {OrgService} from "../services/OrgService"

export class OrgContextMiddleware implements GGTransportMiddleware {
    constructor(
        private readonly orgService: OrgService,
        private readonly orgGuard: AuthGuard<OrgPermission, OrgClaims>,
    ) {}

    async process(): Promise<void> {
        const payload = this.orgGuard.payload()
        if (!payload) return  // optional token — no org context is fine
        // OrgClaims is merged into AccessPayload: payload.orgId is a direct property.
        const org = this.orgService.getOrgById(payload.orgId)
        if (org) OrgContext.set(org)
    }
}
