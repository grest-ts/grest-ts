import {Agent, buildConnector, type Dispatcher} from "undici"
import type {TLSSocket} from "node:tls"
import type {GGConnectionSettings, GGTlsPin} from "@grest-ts/context"
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

/**
 * undici Agent whose connector accepts only a server cert whose SHA-256 fingerprint matches.
 * Self-signed pinning is a unit:
 *  - `rejectUnauthorized: false` skips the CA-chain check — the fingerprint replaces it.
 *  - the peer cert's fingerprint is verified once the socket connects; on mismatch the socket is
 *    destroyed before any request bytes flow. A resumed TLS session doesn't re-send the cert
 *    (`getPeerX509Certificate()` is undefined) and proves knowledge of the original master secret,
 *    so the re-check is safely skipped.
 * `rejectUnauthorized: false` WITHOUT the fingerprint check is a full MITM hole.
 */
function createPinnedAgent(pin: GGTlsPin): Agent {
    const expected = normalizeFingerprint(pin.fingerprint256)
    if (!/^[0-9a-f]{64}$/.test(expected)) {
        throw new Error(`pinned TLS: fingerprint must be 64 hex chars (got "${pin.fingerprint256}")`)
    }
    const baseConnector = buildConnector({rejectUnauthorized: false, servername: pin.servername})
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
                    const actual = tls.getPeerX509Certificate()?.fingerprint256
                    if (!actual || normalizeFingerprint(actual) !== expected) {
                        tls.destroy()
                        return cb(new Error(`pinned TLS: cert fingerprint mismatch — expected ${expected}, got ${actual ? normalizeFingerprint(actual) : "<none>"}`), null)
                    }
                }
                cb(null, socket)
            })
        },
    })
}

// One pinned Agent per fingerprint. Fingerprints rotate per server start, so entries are
// per-server-run; invalidate() drops stale sockets after a restart, and the LRU cap + idle TTL
// bound the map for long-lived multi-target processes that never invalidate.
class PinnedAgentCache {

    private readonly agents = new Map<string, {agent: Agent; lastUsed: number}>()
    private readonly sweepTimer: NodeJS.Timeout

    constructor() {
        this.sweepTimer = setInterval(() => this.sweepIdle(), DEFAULT_SWEEP_INTERVAL_MS)
        this.sweepTimer.unref()
    }

    get(pin: GGTlsPin): Agent {
        const key = normalizeFingerprint(pin.fingerprint256)
        const existing = this.agents.get(key)
        if (existing) {
            existing.lastUsed = Date.now()
            this.agents.delete(key)
            this.agents.set(key, existing)
            return existing.agent
        }
        const agent = createPinnedAgent(pin)
        this.agents.set(key, {agent, lastUsed: Date.now()})
        while (this.agents.size > DEFAULT_MAX_AGENTS) {
            const lru = this.agents.keys().next().value
            if (lru === undefined) break
            this.drop(lru)
        }
        return agent
    }

    invalidate(fingerprint: string): void {
        this.drop(normalizeFingerprint(fingerprint))
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

const PIN_CACHE = new PinnedAgentCache()

/** Drop the pooled pinned dispatcher for a fingerprint so stale sockets don't linger after a restart. */
export function invalidateTlsPinAgent(fingerprint256: string): void {
    PIN_CACHE.invalidate(fingerprint256)
}

/**
 * Map connection settings onto an undici dispatcher — the single extensibility seam. Future
 * settings (proxy → ProxyAgent, ca/clientCert → Agent connect options, http2 → allowH2, …) add a
 * branch here, with no change to the transport or the middleware hook.
 */
function dispatcherFor(settings: GGConnectionSettings): Dispatcher | undefined {
    if (settings.tlsPin) return PIN_CACHE.get(settings.tlsPin)
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
