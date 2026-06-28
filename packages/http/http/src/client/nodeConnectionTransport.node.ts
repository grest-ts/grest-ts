import {createHash} from "node:crypto"
import type {TLSSocket} from "node:tls"
import {Agent, buildConnector, type Dispatcher} from "undici"
import type {GGConnectionSettings} from "@grest-ts/context"
import type {GGHttpTransport} from "./GGHttpSchema.createClient"

/**
 * Node default transport: ordinary `fetch`, dialing through an undici dispatcher built from the
 * request's connection settings. `fetch` keeps the wire correct (real Response/headers/streaming,
 * FormData, abort, redirects); the dispatcher is the one node-only seam. When no settings call for
 * a custom dispatcher it's plain `fetch` — identical to the browser path.
 */

const DEFAULT_MAX_AGENTS = 2048
const DEFAULT_IDLE_TTL_MS = 5 * 60_000
const DEFAULT_SWEEP_INTERVAL_MS = 60_000

function normalizeFingerprint(input: string): string {
    return input.replace(/:/g, "").toLowerCase()
}

/** Which settings shape the TLS connection (and therefore the dispatcher). */
function needsDispatcher(s: GGConnectionSettings): boolean {
    return !!(s.tlsPin || s.ca || s.clientCert)
}

/** tls.connect options shared by both the pinned and the standard connector. */
function connectOptions(s: GGConnectionSettings) {
    return {
        ca: s.ca,
        cert: s.clientCert?.cert,
        key: s.clientCert?.key,
        passphrase: s.clientCert?.passphrase,
    }
}

/**
 * Build the undici Agent for a set of TLS settings.
 *  - tlsPin → self-signed pinning: `rejectUnauthorized: false` (skip the CA chain — the fingerprint
 *    replaces it) + verify the peer cert's fingerprint once connected, destroying the socket on
 *    mismatch before any request bytes flow. A resumed TLS session doesn't re-send the cert and
 *    proves knowledge of the original master secret, so the re-check is safely skipped.
 *    `rejectUnauthorized: false` WITHOUT the fingerprint check is a full MITM hole.
 *  - otherwise → standard verification, optionally against a custom `ca` and presenting a
 *    `clientCert` for mTLS.
 */
function buildAgent(s: GGConnectionSettings): Agent {
    const connect = connectOptions(s)
    const pin = s.tlsPin
    if (!pin) {
        return new Agent({connect})
    }
    const expected = normalizeFingerprint(pin.fingerprint256)
    if (!/^[0-9a-f]{64}$/.test(expected)) {
        throw new Error(`pinned TLS: fingerprint must be 64 hex chars (got "${pin.fingerprint256}")`)
    }
    const baseConnector = buildConnector({...connect, rejectUnauthorized: false, servername: pin.servername})
    return new Agent({
        connect(opts, cb) {
            baseConnector(opts, (err, socket) => {
                if (err) return cb(err, null)
                const tls = socket as TLSSocket
                if (typeof tls.getPeerX509Certificate !== "function") {
                    socket.destroy()
                    return cb(new Error("pinned TLS requires an https target"), null)
                }
                if (!tls.isSessionReused()) {
                    const raw = tls.getPeerX509Certificate()?.fingerprint256
                    const actual = raw ? normalizeFingerprint(raw) : undefined
                    if (actual !== expected) {
                        tls.destroy()
                        return cb(new Error(`pinned TLS: cert fingerprint mismatch — expected ${expected}, got ${actual ?? "<none>"}`), null)
                    }
                }
                cb(null, socket)
            })
        },
    })
}

/**
 * Stable key per distinct TLS config, so each pools its own connections. Pin-only (the common,
 * high-frequency case) keys off the cheap fingerprint; CA/mTLS hash the (larger) PEM material.
 */
function agentKey(s: GGConnectionSettings): string {
    const pin = s.tlsPin ? `${normalizeFingerprint(s.tlsPin.fingerprint256)}|${s.tlsPin.servername ?? ""}` : ""
    if (!s.ca && !s.clientCert) return `pin:${pin}`
    return "tls:" + createHash("sha256").update(JSON.stringify([
        pin,
        s.ca ?? null,
        s.clientCert?.cert ?? null,
        s.clientCert?.key ?? null,
        s.clientCert?.passphrase ?? null,
    ])).digest("hex")
}

// One Agent per distinct TLS config. Pinned fingerprints rotate per server start, so those entries
// are per-server-run; invalidate() drops them after a restart, and the LRU cap + idle TTL bound the
// map for long-lived multi-target processes that never invalidate.
class TlsAgentCache {

    private readonly agents = new Map<string, {agent: Agent; fingerprint?: string; lastUsed: number}>()
    private readonly sweepTimer: NodeJS.Timeout

    constructor() {
        this.sweepTimer = setInterval(() => this.sweepIdle(), DEFAULT_SWEEP_INTERVAL_MS)
        this.sweepTimer.unref()
    }

    get(settings: GGConnectionSettings): Agent {
        const key = agentKey(settings)
        const existing = this.agents.get(key)
        if (existing) {
            existing.lastUsed = Date.now()
            this.agents.delete(key)
            this.agents.set(key, existing)
            return existing.agent
        }
        const agent = buildAgent(settings)
        const fingerprint = settings.tlsPin ? normalizeFingerprint(settings.tlsPin.fingerprint256) : undefined
        this.agents.set(key, {agent, fingerprint, lastUsed: Date.now()})
        while (this.agents.size > DEFAULT_MAX_AGENTS) {
            const lru = this.agents.keys().next().value
            if (lru === undefined) break
            this.drop(lru)
        }
        return agent
    }

    invalidateFingerprint(fingerprint: string): void {
        const fp = normalizeFingerprint(fingerprint)
        for (const [key, entry] of this.agents) {
            if (entry.fingerprint === fp) this.drop(key)
        }
    }

    private sweepIdle(): void {
        const cutoff = Date.now() - DEFAULT_IDLE_TTL_MS
        for (const [key, entry] of this.agents) {
            if (entry.lastUsed < cutoff) this.drop(key)
        }
    }

    private drop(key: string): void {
        const existing = this.agents.get(key)
        if (!existing) return
        // close() drains in-flight requests then closes idle sockets; destroy() is the hard fallback.
        existing.agent.close().catch(() => existing.agent.destroy())
        this.agents.delete(key)
    }
}

const AGENT_CACHE = new TlsAgentCache()

/** Drop the pooled dispatcher(s) for a pinned fingerprint so stale sockets don't linger after a restart. */
export function invalidateTlsPinAgent(fingerprint256: string): void {
    AGENT_CACHE.invalidateFingerprint(fingerprint256)
}

/**
 * Map connection settings onto an undici dispatcher — the single extensibility seam. Future
 * settings (proxy → ProxyAgent, http2 → allowH2, …) add a branch here, with no change to the
 * transport or the middleware hook.
 */
function dispatcherFor(settings: GGConnectionSettings): Dispatcher | undefined {
    if (needsDispatcher(settings)) return AGENT_CACHE.get(settings)
    return undefined
}

/** url is path-only for a url-less client; settings.host (when set) supplies the origin. */
function dialUrl(url: string, settings: GGConnectionSettings): string {
    if (!settings.host) return url
    const port = settings.port ? `:${settings.port}` : ""
    return `https://${settings.host}${port}${url}`
}

export const nodeDefaultTransport: GGHttpTransport = (url, init) => {
    const {connectionSettings = {}, ...rest} = init
    const dispatcher = dispatcherFor(connectionSettings)
    return fetch(dialUrl(url, connectionSettings), {...rest, dispatcher} as RequestInit & {dispatcher?: Dispatcher})
}
