import {ERROR_JSON, OK, SERVER_ERROR} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformClientConfig} from "../../schema/GGHttpSchema";

/** Collapse whitespace and clip a response body to a short, log-safe snippet so a
 *  non-JSON / wrong-shape response can say what it actually was. */
function bodySnippet(body: string, max = 300): string {
    const clean = body.replace(/\s+/g, " ").trim();
    if (!clean) return "(empty body)";
    return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export class GGRpcResponseParser {

    constructor(config: ClientHttpRouteToRpcTransformClientConfig) {

    }

    parseResponse = async (response: Response): Promise<OK<unknown> | ERROR_JSON<string, unknown>> => {
        const txt = await response.text();
        try {
            const json = txt ? JSON.parse(txt) : {};
            if (typeof json === "object" && "success" in json && "type" in json) {
                return json
            } else {
                // The status + body snippet ride displayMessage, the one context field
                // that survives the wire and createErrorObj reconstruction, so the caller
                // sees what came back instead of a bare "Invalid response format".
                return new SERVER_ERROR({displayMessage: `Unexpected response shape (HTTP ${response.status}) — not a grest OK/error envelope: ${bodySnippet(txt)}`, debugData: {json: json}});
            }
        } catch (err) {
            return new SERVER_ERROR({displayMessage: `Failed to parse response as JSON (HTTP ${response.status}): ${bodySnippet(txt)}`, originalError: err, debugData: {text: txt}});
        }
    }
}
