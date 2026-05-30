import {OidcIdp, type OidcIdpOptions} from "./OidcIdp"

export type OktaIdpOptions = Omit<OidcIdpOptions, "provider">

// OidcIdp labelled "okta" — Okta is a standard OIDC issuer with a per-tenant issuer URL.
export class OktaIdp extends OidcIdp {
    constructor(options: OktaIdpOptions) {
        super({...options, provider: "okta"})
    }
}
