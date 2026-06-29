import {GGContractExecutor, GGValidator, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GGContext, GGContextKey, GGContextStore, GGOutbound, type GGTransportMiddleware} from "@grest-ts/context";
import {GGContextKeySynchronizer} from "@grest-ts/http";
import {withTimeout} from "@grest-ts/common";
import {GG_TRACE} from "@grest-ts/trace";
import {SocketAdapter} from "../socket/SocketAdapter";
import {GG_WS_CONNECTION} from "../server/GG_WS_CONNECTION";
import {Message, MessageType} from "../socket/SocketMessage";

export function buildWsUrl(domain: string, path: string, query: any): string {
    let url = domain + path;
    if (query) {
        const entries: [string, string][] = Object.entries(query).map(([k, v]) => [k, String(v)]);
        url += '?' + new URLSearchParams(entries).toString();
    }
    return url;
}

export function validateWsQuery(validator: GGValidator<any> | undefined, query: any): any {
    if (!validator || query === undefined) return query;
    const parsed = validator.safeParse(query, true);
    if (parsed.success === false) {
        throw new VALIDATION_ERROR(parsed.issues.toJSON(), {displayMessage: "Invalid query parameters"});
    }
    return parsed.value;
}

export function buildHandshakeHeaders(middlewares: readonly GGTransportMiddleware[]): Record<string, string> {
    const outbound: GGOutbound = {headers: {}};
    for (const m of middlewares) m.update?.(outbound);
    return outbound.headers;
}

/**
 * Await GGContextKeySynchronizer.waitFor for each middleware that carries a context
 * key, so a freshly-set credential (auth token, session) is read at its current value
 * rather than a stale one. Call before reading middleware keys / building headers.
 */
export async function gateMiddlewares(middlewares: readonly GGTransportMiddleware[] | undefined): Promise<void> {
    if (!middlewares) return;
    for (const mw of middlewares) {
        if (mw instanceof GGContextKey) {
            await GGContextKeySynchronizer.waitFor(mw);
        }
    }
}

/**
 * Reconstruct the typed error the server threw during handshake.
 *
 * The server sends `error.toJSON()` which has `{success:false, type, data?, context?}`.
 * System errors (NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, etc.) are reconstructed
 * as real instances so callers can `.toBeError(NOT_AUTHORIZED)`. Anything we can't
 * identify (non-ERROR throw, custom error class the client doesn't know) falls back
 * to SERVER_ERROR carrying the original payload for inspection.
 */
export function reconstructHandshakeError(payload: any): Error {
    if (payload && typeof payload === 'object' && typeof payload.type === 'string') {
        return GGContractExecutor.createErrorObj(payload) as unknown as Error;
    }
    return new SERVER_ERROR({
        displayMessage: 'WebSocket handshake failed',
        originalError: payload,
    });
}

/**
 * Open one client socket: wait for the transport to connect, then run the in-band handshake
 * inside a fresh context parented to the connecting one (so context-keyed credentials resolve
 * when headers are built), and resolve `makeSocket(adapter, context)` once HANDSHAKE_OK lands.
 * Shared by the typed (GGSocket) and raw (GGRawSocket) clients — they differ only in the
 * context name and what they wrap the live adapter in.
 */
export function openClientConnection<T>(opts: {
    adapter: SocketAdapter;
    domain: string;
    middlewares: readonly GGTransportMiddleware[] | undefined;
    contextName: string;
    handshakeTimeoutMs: number;
    makeSocket: (adapter: SocketAdapter, context: GGContext) => T;
}): Promise<T> {
    const {adapter, domain, middlewares, contextName, handshakeTimeoutMs, makeSocket} = opts;
    return new Promise<T>((resolve, reject) => {
        adapter.onOpen(async () => {
            try {
                const context = new GGContext(contextName, GGContextStore.tryGetContext());
                await context.run(async () => {
                    GG_TRACE.init();
                    GG_WS_CONNECTION.set({port: undefined, path: domain});
                    await gateMiddlewares(middlewares);
                    const headers = buildHandshakeHeaders(middlewares ?? []);
                    adapter.send(Message.create(MessageType.HANDSHAKE, "", "", headers));
                    // Build on OK, not after it: ws can deliver OK and a following server frame
                    // back-to-back, so the socket's listener must exist the instant OK lands.
                    resolve(await awaitHandshakeResponse(adapter, handshakeTimeoutMs, () => makeSocket(adapter, context)));
                });
            } catch (error) {
                reject(error);
            }
        });
        adapter.onError(reject);
    });
}

/**
 * Listen for the handshake response. The caller actually SENDS the HANDSHAKE frame.
 * `build` runs synchronously when HANDSHAKE_OK is parsed (before the next frame is
 * dispatched) and its result resolves the promise.
 */
export function awaitHandshakeResponse<T>(adapter: SocketAdapter, timeoutMs: number, build: () => T): Promise<T> {
    return withTimeout(new Promise<T>((resolve, reject) => {
        const onMsg = (data: string) => {
            const msg = Message.parse(data);
            if (!msg) return;
            if (msg.type === MessageType.HANDSHAKE_OK) {
                adapter.offMessage(onMsg);
                resolve(build());
            } else if (msg.type === MessageType.HANDSHAKE_ERR) {
                adapter.offMessage(onMsg);
                reject(reconstructHandshakeError(msg.data));
            }
        };
        adapter.onMessage(onMsg);
        adapter.onError(reject);
    }), timeoutMs, 'Handshake timeout');
}
