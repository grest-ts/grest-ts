import {GGSocket} from '../socket/GGSocket'
import {SocketAdapter} from "../socket/SocketAdapter"
import {GGValidator} from "@grest-ts/schema"
import {type GGTransportMiddleware} from "@grest-ts/context"
import {getDefaultAdapter} from "../adapter/getDefaultAdapter"
import {buildHandshakeHeaders, buildWsUrl, gateMiddlewares, openClientConnection} from "./clientHandshake"
import {createConnector, normalizeReconnect, type GGConnector} from "./reconnectConnector"
import {GGWsLogMode} from "./GGWsLogMode"
import {getPoolBucket} from "./GGSocketPoolStorage"

export interface GGSocketPoolConfig<Query = any> {
    domain: string
    path: string
    query?: Query
    queryValidator?: GGValidator<Query>
    middlewares?: readonly GGTransportMiddleware[]
}

export type SetupHook = (socket: GGSocket) => Promise<void>

interface HookEntry {
    fn: SetupHook
    // Which socket this hook has been applied to. Used to avoid double-running
    // on initial connect when setup() and attach() could both try to fire it.
    appliedSocket: GGSocket | undefined
}

export class GGPoolEntry {
    readonly key: string
    private readonly pool: Map<string, GGPoolEntry>
    readonly connector: GGConnector<GGSocket>
    private readonly hookEntries = new Map<symbol, HookEntry>()
    private readonly disconnectCallbacks = new Map<symbol, (reason: "manual" | "drop") => void>()
    private readonly closeCallbacks = new Map<symbol, (reason: string, error: Error | undefined) => void>()
    private readonly errorCallbacks = new Map<symbol, (error: Error) => void>()
    private refCount = 0
    private connectingPromise: Promise<void> | null = null

    constructor(key: string, pool: Map<string, GGPoolEntry>, openFn: () => Promise<GGSocket>) {
        this.key = key
        this.pool = pool

        const hookEntries = this.hookEntries
        this.connector = createConnector<GGSocket>({
            schemaName: key.split('::')[0],
            logMode: GGWsLogMode.ALL,
            reconnect: normalizeReconnect(undefined),
            open: openFn,
            setup: async (socket) => {
                for (const entry of hookEntries.values()) {
                    if (entry.appliedSocket !== socket) {
                        try {
                            await entry.fn(socket)
                            entry.appliedSocket = socket
                        } catch (e) {
                            console.error('[GGSocketPool] client setup hook error:', e)
                        }
                    }
                }
            },
        })

        this.connector.onDisconnect((reason) => {
            for (const cb of this.disconnectCallbacks.values()) {
                try { cb(reason) } catch (_) {}
            }
        })

        this.connector.onClose((reason, error) => {
            // "manual" means the last client called disconnect/close — the per-client
            // disconnect()/close() methods already fire the manual callbacks directly.
            if (reason !== "manual") {
                for (const cb of this.closeCallbacks.values()) {
                    try { cb(reason, error) } catch (_) {}
                }
            }
        })

        this.connector.onError((error) => {
            for (const cb of this.errorCallbacks.values()) {
                try { cb(error) } catch (_) {}
            }
        })
    }

    isConnected(): boolean { return this.connector.isConnected() }
    current(): GGSocket | undefined { return this.connector.current() }
    forceReconnect(): void { this.connector.forceReconnect() }

    async attach(clientId: symbol, hook: SetupHook): Promise<void> {
        this.refCount++
        const hookEntry: HookEntry = {fn: hook, appliedSocket: undefined}
        this.hookEntries.set(clientId, hookEntry)

        try {
            if (!this.connector.isConnected() && !this.connectingPromise) {
                this.connectingPromise = this.connector.connect().finally(() => {
                    this.connectingPromise = null
                })
            }

            if (this.connectingPromise) {
                await this.connectingPromise
            }

            // If setup() ran before this hook was registered (race between
            // in-flight connect and a late attach), apply the hook now.
            const socket = this.connector.current()
            if (socket && hookEntry.appliedSocket !== socket) {
                await hook(socket)
                hookEntry.appliedSocket = socket
            }
        } catch (err) {
            this.hookEntries.delete(clientId)
            this.refCount--
            if (this.refCount <= 0) this.pool.delete(this.key)
            throw err
        }
    }

    detach(clientId: symbol, schemaPrefix: string, graceful: boolean): void {
        this.hookEntries.delete(clientId)
        // Remove callbacks before triggering any connector close, so pool-level
        // "manual" close events don't reach a client that has already detached.
        this.disconnectCallbacks.delete(clientId)
        this.closeCallbacks.delete(clientId)
        this.errorCallbacks.delete(clientId)

        const socket = this.connector.current()
        if (socket) socket.unregisterHandlers(schemaPrefix)

        this.refCount--
        if (this.refCount <= 0) {
            this.pool.delete(this.key)
            if (graceful) {
                this.connector.disconnect().catch(() => {})
            } else {
                this.connector.close()
            }
        }
    }

    registerDisconnect(clientId: symbol, cb: (reason: "manual" | "drop") => void): void {
        this.disconnectCallbacks.set(clientId, cb)
    }

    registerClose(clientId: symbol, cb: (reason: string, error: Error | undefined) => void): void {
        this.closeCallbacks.set(clientId, cb)
    }

    registerError(clientId: symbol, cb: (error: Error) => void): void {
        this.errorCallbacks.set(clientId, cb)
    }
}

export class GGSocketPool {
    private static adapter: any = null
    private static adapterPromise: Promise<any> | null = null

    private static pool(): Map<string, GGPoolEntry> {
        return getPoolBucket() as Map<string, GGPoolEntry>
    }

    public static get size(): number {
        return this.pool().size
    }

    public static setAdapter(adapter: new(args: any, options?: any) => SocketAdapter): void {
        this.adapter = adapter
        this.adapterPromise = Promise.resolve(adapter)
    }

    private static async ensureAdapter(): Promise<any> {
        if (this.adapter) return this.adapter
        if (!this.adapterPromise) this.adapterPromise = getDefaultAdapter()
        this.adapter = await this.adapterPromise
        return this.adapter
    }

    private static buildUrl(config: GGSocketPoolConfig): string {
        return buildWsUrl(config.domain, config.path, config.query)
    }

    // Build the deduplication key: fully resolved URL + serialised auth headers.
    static async buildKey(config: GGSocketPoolConfig): Promise<string> {
        await gateMiddlewares(config.middlewares)
        const headers = buildHandshakeHeaders(config.middlewares ?? [])
        const fullUrl = this.buildUrl(config)
        const headerKey = Object.entries(headers).sort().map(([k, v]) => `${k}=${v}`).join('&')
        return fullUrl + "::" + headerKey
    }

    // Return the existing pool entry for key, or create and register a new one.
    // Synchronous once the key is known — call buildKey() first.
    static getOrCreateEntry(config: GGSocketPoolConfig, key: string): GGPoolEntry {
        const pool = this.pool()
        let entry = pool.get(key)
        if (!entry) {
            const capturedConfig = config
            entry = new GGPoolEntry(key, pool, () => this._openSocket(capturedConfig))
            pool.set(key, entry)
        }
        return entry
    }

    static detach(key: string, clientId: symbol, schemaPrefix: string, graceful: boolean): void {
        const entry = this.pool().get(key)
        if (entry) entry.detach(clientId, schemaPrefix, graceful)
    }

    // Dedicated (non-pooled) connection — always a fresh socket, not registered in the pool.
    static async connect<Query>(config: GGSocketPoolConfig<Query>): Promise<GGSocket> {
        return this._openSocket(config)
    }

    static async closeAll(graceful = true): Promise<void> {
        const pool = this.pool()
        const entries = Array.from(pool.values())
        pool.clear()
        if (graceful) {
            await Promise.allSettled(entries.map(e => e.connector.disconnect()))
        } else {
            for (const e of entries) e.connector.close()
        }
    }

    static __clearForTesting(): void {
        this.pool().clear()
        this.adapter = null
        this.adapterPromise = null
    }

    static async _openSocket(config: GGSocketPoolConfig): Promise<GGSocket> {
        const adapterClass = await this.ensureAdapter()
        const fullUrl = this.buildUrl(config)
        return openClientConnection({
            adapter: new adapterClass(fullUrl),
            domain: config.domain,
            middlewares: config.middlewares,
            contextName: "ws-client-connection",
            handshakeTimeoutMs: 5000,
            makeSocket: (adapter, context) => new GGSocket(adapter, {connectionContext: context}),
        })
    }
}
