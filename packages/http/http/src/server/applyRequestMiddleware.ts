import type http from "http";
import type {GGInbound, GGTransportMiddleware} from "@grest-ts/context";

/**
 * Normalizes a Node request + parsed query into a GGInbound and runs the server-side
 * pipeline: every parse() (populating context keys) before any process() (async
 * validation), so a middleware can validate against a key an earlier one parsed.
 * The cookie is taken only from the real request header — never from anywhere a
 * client could forge — preserving the anti-spoof guarantee on every transport.
 */
export async function applyRequestMiddleware(
    req: http.IncomingMessage,
    queryArgs: Record<string, string | string[]>,
    middlewares: readonly GGTransportMiddleware[]
): Promise<void> {
    if (middlewares.length === 0) return;
    const inbound: GGInbound = {
        headers: flatten(req.headers),
        cookie: typeof req.headers.cookie === "string" ? req.headers.cookie : undefined,
        query: flatten(queryArgs)
    };
    for (const mw of middlewares) mw.parse?.(inbound);
    for (const mw of middlewares) await mw.process?.();
    for (const mw of middlewares) mw.clear?.();
}

function flatten(src: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const key in src) {
        const value = src[key];
        out[key] = Array.isArray(value) ? value[0] : value;
    }
    return out;
}
