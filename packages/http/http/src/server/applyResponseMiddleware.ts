import type http from "http";
import type {GGResponse, GGTransportMiddleware} from "@grest-ts/context";

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
    middlewares: readonly GGTransportMiddleware[] | undefined
): void {
    if (!middlewares?.length || res.headersSent) return;
    let response: GGResponse | undefined;
    for (const mw of middlewares) {
        if (!mw.respond) continue;
        response ??= {headers: {}};
        mw.respond(response);
    }
    if (!response) return;
    for (const name in response.headers) {
        res.setHeader(name, response.headers[name]);
    }
}
