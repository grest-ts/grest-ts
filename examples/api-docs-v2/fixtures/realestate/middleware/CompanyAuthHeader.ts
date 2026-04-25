import {GGContextKey} from "@grest-ts/context";
import {GGHttpRequest} from "@grest-ts/http";
import {IsString} from "@grest-ts/schema";

// ---------------------------------------------------------
// Company Auth Token - for client/server header transport
// ---------------------------------------------------------

class CompanyAuthHeader extends GGContextKey<string> {

    public readonly headers = {
        "x-company-auth": IsString.docs({title: "Company auth token", description: "Per-company API key used in addition to the user bearer token", format: "api-key"})
    } as const;

    public readonly responseHeaders: Record<string, never> = {};

    updateRequest(req: GGHttpRequest): void {
        const token = GG_COMPANY_AUTH_TOKEN.get();
        if (token) {
            req.headers["x-company-auth"] = token;
        }
    }

    parseRequest(req: GGHttpRequest): void {
        const header = req.headers?.["x-company-auth"];
        if (header && typeof header === "string") {
            GG_COMPANY_AUTH_TOKEN.set(header);
        }
    }
}

export const GG_COMPANY_AUTH_TOKEN = new CompanyAuthHeader("company-auth-token", IsString);
