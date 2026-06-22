import {ERROR_JSON, OK, SERVER_ERROR, GGSchemaNonJsonDefinition, GGSchemaBinaryData, isNonJsonDef} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformClientConfig} from "@grest-ts/http";

export class GGFileDownloadResponseParser {

    private readonly decodeFromRaw: GGSchemaNonJsonDefinition["decodeFromRaw"]

    constructor(config: ClientHttpRouteToRpcTransformClientConfig) {
        const def = config.contract.success!.toCompilerDef();
        if (!isNonJsonDef(def)) {
            throw new Error("GGFileDownloadResponseParser: output schema must be a non-JSON leaf type (e.g. IsFile).");
        }
        this.decodeFromRaw = def.decodeFromRaw.bind(def);
    }

    parseResponse = async (response: Response): Promise<OK<unknown> | ERROR_JSON<string, unknown>> => {
        if (response.status === 200) {
            try {
                const arrayBuffer = await response.arrayBuffer();
                const contentType = response.headers.get('content-type') || 'application/octet-stream';
                const filename = parseFilenameFromContentDisposition(response.headers.get('content-disposition'));
                const blob = new Blob([arrayBuffer], {type: contentType});
                const raw: GGSchemaBinaryData = {path: "", blob, filename};
                const data = await this.decodeFromRaw(raw);
                return {success: true, type: "OK", data};
            } catch (err) {
                return new SERVER_ERROR({displayMessage: "Failed to decode download response", originalError: err});
            }
        } else {
            const txt = await response.text();
            try {
                const json = txt ? JSON.parse(txt) : {};
                if (typeof json === "object" && "success" in json && "type" in json) {
                    return json;
                } else {
                    return new SERVER_ERROR({displayMessage: `Unexpected error response shape (HTTP ${response.status}) — not a grest error envelope: ${bodySnippet(txt)}`, debugData: {json}});
                }
            } catch (err) {
                return new SERVER_ERROR({displayMessage: `Failed to parse error response as JSON (HTTP ${response.status}): ${bodySnippet(txt)}`, originalError: err, debugData: {text: txt}});
            }
        }
    }
}

function parseFilenameFromContentDisposition(header: string | null): string | undefined {
    if (!header) return undefined;
    const match = header.match(/filename=([^\s;]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
}

/** Collapse whitespace and clip an error body to a short, log-safe snippet so a
 *  non-JSON / wrong-shape error response can say what it actually was. */
function bodySnippet(body: string, max = 300): string {
    const clean = body.replace(/\s+/g, " ").trim();
    if (!clean) return "(empty body)";
    return clean.length > max ? clean.slice(0, max) + "…" : clean;
}
