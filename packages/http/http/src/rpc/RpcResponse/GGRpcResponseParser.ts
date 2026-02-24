import {ERROR_JSON, OK, SERVER_ERROR} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformClientConfig} from "../../schema/GGHttpSchema";

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
                return new SERVER_ERROR({displayMessage: "Invalid response format!", debugData: {json: json}});
            }
        } catch (err) {
            return new SERVER_ERROR({displayMessage: "Failed to parse JSON", originalError: err, debugData: {text: txt}});
        }
    }
}
