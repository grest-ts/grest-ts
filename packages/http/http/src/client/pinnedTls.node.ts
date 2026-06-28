import https, {Agent as HttpsAgent} from "node:https"
import type {TLSSocket} from "node:tls"
import type {GGTlsPin} from "@grest-ts/context"
import type {GGHttpTransport} from "./GGHttpSchema.createClient"

/**
 * https.Agent that accepts only a server cert whose SHA-256 fingerprint exactly matches
 * `expectedFingerprintHex`.
 *
 * The three options below are a unit — do NOT extract any one into ad-hoc use:
 *  - `rejectUnauthorized: false` — pinned servers are typically self-signed; this disables the
 *    CA-chain check. The fingerprint check below replaces it.
 *  - `checkServerIdentity: () => undefined` — we dial by IP/arbitrary host; the cert CN would
 *    always fail hostname verification.
 *  - On `secureConnect` we compare the peer cert's fingerprint256 byte-for-byte.
 *    Mismatch → socket destroyed before any request bytes flow.
 *
 * `rejectUnauthorized: false` without the fingerprint check is a full MITM vulnerability.
 */
function createPinnedTlsAgent(expectedFingerprintHex: string): HttpsAgent {
    const expected = normalizeFingerprint(expectedFingerprintHex)
    if (!/^[0-9a-f]{64}$/.test(expected)) {
        throw new Error(`pinned TLS: expected fingerprint must be 64 hex chars (got ${expectedFingerprintHex.length})`)
    }

    const agent = new HttpsAgent({
        keepAlive: true,
        maxSockets: 10,
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
    })

    const origCreateConnection = (agent as any).createConnection.bind(agent)
    ;(agent as any).createConnection = (options: any, callback: any) => {
        const socket: TLSSocket = origCreateConnection(options, callback)
        socket.on("secureConnect", () => {
            // TLS session resumption: on resumed handshakes, Node reuses cached session
            // tickets and the server does not re-send its cert, so getPeerX509Certificate()
            // returns undefined. A resumed session proves knowledge of the original master
            // secret, so skipping fingerprint re-check is cryptographically safe.
            if (socket.isSessionReused()) return
            const actual = socket.getPeerX509Certificate()?.fingerprint256
            const actualNormalized = actual ? normalizeFingerprint(actual) : undefined
            if (actualNormalized !== expected) {
                socket.destroy(new Error(
                    `pinned TLS: cert fingerprint mismatch — expected ${expected}, got ${actualNormalized ?? "<none>"}`
                ))
            }
        })
        return socket
    }

    return agent
}

function normalizeFingerprint(input: string): string {
    return input.replace(/:/g, "").toLowerCase()
}

const DEFAULT_MAX_AGENTS = 2048
const DEFAULT_IDLE_TTL_MS = 5 * 60_000
const DEFAULT_SWEEP_INTERVAL_MS = 60_000

// Cert fingerprints rotate per server start, so each entry is per-server-run. invalidate() is a
// correctness drop (kill stale sockets after a restart); the LRU cap + idle TTL are the only
// bound for long-lived multi-target processes that never invalidate — orphaned fingerprints age
// out since nothing re-dials them.
class ConnectionAgentCache {

    private readonly agents = new Map<string, {agent: HttpsAgent; lastUsed: number}>()
    private sweepTimer: NodeJS.Timeout

    constructor() {
        this.sweepTimer = setInterval(() => this.sweepIdle(), DEFAULT_SWEEP_INTERVAL_MS)
        this.sweepTimer.unref()
    }

    get(fingerprint: string): HttpsAgent {
        const existing = this.agents.get(fingerprint)
        if (existing) {
            existing.lastUsed = Date.now()
            this.agents.delete(fingerprint)
            this.agents.set(fingerprint, existing)
            return existing.agent
        }
        const agent = createPinnedTlsAgent(fingerprint)
        this.agents.set(fingerprint, {agent, lastUsed: Date.now()})
        while (this.agents.size > DEFAULT_MAX_AGENTS) {
            const lru = this.agents.keys().next().value
            if (lru === undefined) break
            this.drop(lru)
        }
        return agent
    }

    invalidate(fingerprint: string): void {
        this.drop(fingerprint)
    }

    private sweepIdle(): void {
        const cutoff = Date.now() - DEFAULT_IDLE_TTL_MS
        for (const [fingerprint, entry] of this.agents) {
            if (entry.lastUsed < cutoff) this.drop(fingerprint)
        }
    }

    private drop(fingerprint: string): void {
        const existing = this.agents.get(fingerprint)
        if (!existing) return
        try { existing.agent.destroy() } catch { /* ignore */ }
        this.agents.delete(fingerprint)
    }
}

const AGENT_CACHE = new ConnectionAgentCache()

/** Drop the pooled agent for a fingerprint so stale sockets don't linger after a server restart. */
export function invalidateTlsPinAgent(fingerprint256: string): void {
    AGENT_CACHE.invalidate(normalizeFingerprint(fingerprint256))
}

type TransportInit = Parameters<GGHttpTransport>[1]

export const nodeDefaultTransport: GGHttpTransport = (url, init) => {
    const pin = init.connectionSettings?.tlsPin
    if (pin === undefined) return fetch(url, init as RequestInit)
    const agent = AGENT_CACHE.get(normalizeFingerprint(pin.fingerprint256))
    return pinnedHttpsRequest(url, init, pin, agent)
}

function pinnedHttpsRequest(path: string, init: TransportInit, pin: GGTlsPin, agent: HttpsAgent): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
        const onAbort = () => req.destroy(new Error("Request aborted"))
        if (init.signal.aborted) {
            reject(new Error("Request aborted"))
            return
        }
        init.signal.addEventListener("abort", onAbort, {once: true})

        const req = https.request({
            host: pin.host,
            port: pin.port,
            path,
            method: init.method,
            headers: init.headers,
            servername: pin.servername,
            agent,
        }, res => {
            let text = ""
            res.setEncoding("utf-8")
            res.on("data", chunk => { text += chunk })
            res.on("end", () => {
                init.signal.removeEventListener("abort", onAbort)
                // Response constructor rejects status outside 200..599; clamp to 500.
                const raw = res.statusCode ?? 500
                const status = raw >= 200 && raw <= 599 ? raw : 500
                resolve(new Response(text, {status}))
            })
            res.on("error", err => {
                init.signal.removeEventListener("abort", onAbort)
                reject(err)
            })
        })
        req.on("error", err => {
            init.signal.removeEventListener("abort", onAbort)
            reject(err)
        })
        const body = init.body
        if (body !== undefined) {
            if (typeof body !== "string") {
                reject(new Error("Pinned TLS transport only supports string bodies"))
                return
            }
            req.write(body)
        }
        req.end()
    })
}
