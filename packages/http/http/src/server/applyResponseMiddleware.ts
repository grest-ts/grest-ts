import type http from "http";
import type {GGHttpResponse, GGHttpTransportMiddleware} from "../schema/GGHttpSchema";

/**
 * Runs the transport chain's server-side response hook and writes the collected
 * headers onto the Node response. Applied via setHeader (not writeHead) so a
 * string[] value emits one header line per element — the only way to send
 * multiple Set-Cookie headers — and so the codec's later writeHead(Content-*)
 * merges rather than clobbers. Must run inside the request GGContext so a
 * middleware can read per-request staged state.
 */
export function applyResponseMiddleware(
    res: http.ServerResponse,
    middlewares: readonly GGHttpTransportMiddleware[] | undefined
): void {
    if (!middlewares?.length) return;
    let response: GGHttpResponse | undefined;
    for (const mw of middlewares) {
        if (!mw.updateResponse) continue;
        response ??= {headers: {}};
        mw.updateResponse(response);
    }
    if (!response) return;
    for (const name in response.headers) {
        res.setHeader(name, response.headers[name]);
    }
}
