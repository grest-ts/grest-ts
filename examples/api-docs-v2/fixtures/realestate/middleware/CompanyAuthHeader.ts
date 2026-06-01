import {GGContextKey, GGInbound, GGOutbound} from "@grest-ts/context";
import {IsString} from "@grest-ts/schema";

// ---------------------------------------------------------
// Company Auth Token - for client/server header transport
// ---------------------------------------------------------

class CompanyAuthHeader extends GGContextKey<string> {

    public readonly headers = {
        "x-company-auth": IsString.docs({title: "Company auth token", description: "Per-company API key used in addition to the user bearer token", format: "api-key"})
    } as const;

    public readonly responseHeaders: Record<string, never> = {};

    update(outbound: GGOutbound): void {
        const token = GG_COMPANY_AUTH_TOKEN.get();
        if (token) {
            outbound.headers["x-company-auth"] = token;
        }
    }

    parse(inbound: GGInbound): void {
        const header = inbound.headers["x-company-auth"];
        if (header) {
            GG_COMPANY_AUTH_TOKEN.set(header);
        }
    }
}

export const GG_COMPANY_AUTH_TOKEN = new CompanyAuthHeader("company-auth-token", IsString);
