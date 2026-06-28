import {describe, it, expect, beforeAll, afterAll, afterEach, vi} from 'vitest'
import https from 'node:https'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {X509Certificate} from 'node:crypto'
import {GGContractClass, IsObject, IsString, SERVER_ERROR} from '@grest-ts/schema'
import {GGContext, type GGConnectionSettings} from '@grest-ts/context'
import {GGHttpSchema} from '../schema/GGHttpSchema'
import {GGRpc} from '../rpc/GGHttpRouteRPC'
import {createClient} from './GGHttpSchema.createClient'
import {GGConnectionSettingsKey} from '../schema/GGConnectionSettingsKey'
import {invalidateTlsPinAgent} from './pinnedTls.node'
// Side-effect import: registers nodeDefaultTransport as the default for url-less node clients.
import './GGHttpSchema.createClient.node'

const PingContract = new GGContractClass("PinnedTlsTestApi", {
    ping: {
        input: IsObject({msg: IsString}),
        success: IsObject({msg: IsString}),
        errors: [SERVER_ERROR],
    },
})

const CONN = new GGConnectionSettingsKey("pinnedTlsTestConn")

// Mirror the request boundary: the runtime establishes one context per request, the app sets
// the key inside it. We do the same here — one scope per simulated operation, never per call.
function inScope<R>(settings: GGConnectionSettings, fn: () => R): R {
    const ctx = new GGContext("test-req")
    ctx.set(CONN, settings)
    return ctx.run(fn)
}

const PingApi = new GGHttpSchema({
    contract: PingContract,
    pathPrefix: "api/ping",
    routes: {ping: GGRpc.POST("ping")},
    use: [CONN],
})

interface TestServer {
    port: number
    fingerprint256: string
    reqCount: () => number
    connCount: () => number
    close: () => Promise<void>
}

function genCert(dir: string, name: string): {cert: string; key: string} {
    const certPath = join(dir, `${name}.cert.pem`)
    const keyPath = join(dir, `${name}.key.pem`)
    execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-keyout", keyPath, "-out", certPath, "-subj", `/CN=${name}`,
    ], {stdio: "ignore"})
    return {cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8")}
}

async function startServer(cert: string, key: string, replyMsg: string): Promise<TestServer> {
    let reqCount = 0
    let connCount = 0
    const server = https.createServer({cert, key}, (_req, res) => {
        reqCount++
        res.writeHead(200, {"content-type": "application/json"})
        res.end(JSON.stringify({success: true, type: "OK", data: {msg: replyMsg}}))
    })
    server.on("connection", () => { connCount++ })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as {port: number}).port
    return {
        port,
        fingerprint256: new X509Certificate(cert).fingerprint256,
        reqCount: () => reqCount,
        connCount: () => connCount,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
}

describe('pinned-TLS node transport', () => {

    let dir: string
    let serverA: TestServer
    let serverB: TestServer

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), "gg-pin-"))
        const a = genCert(dir, "serverA")
        const b = genCert(dir, "serverB")
        serverA = await startServer(a.cert, a.key, "from-A")
        serverB = await startServer(b.cert, b.key, "from-B")
    })

    afterAll(async () => {
        await serverA?.close()
        await serverB?.close()
        if (dir) rmSync(dir, {recursive: true, force: true})
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('accepts a server whose cert fingerprint matches the pin', async () => {
        const client = createClient(PingApi, {url: ""})
        const res = await inScope(
            {tlsPin: {host: "127.0.0.1", port: serverA.port, fingerprint256: serverA.fingerprint256}},
            () => client.ping({msg: "hi"}),
        )
        expect(res.msg).toBe("from-A")
    })

    it('rejects a fingerprint mismatch before any request bytes flow', async () => {
        const before = serverA.reqCount()
        const client = createClient(PingApi, {url: ""})
        const bogus = "a".repeat(64)
        const res = await inScope(
            {tlsPin: {host: "127.0.0.1", port: serverA.port, fingerprint256: bogus}},
            () => client.ping({msg: "hi"}).asResult(),
        )
        expect(res.success).toBe(false)
        expect(res).toBeInstanceOf(SERVER_ERROR)
        if (res instanceof SERVER_ERROR) {
            const original = res.getDebugContext()?.originalError as Error | undefined
            expect(original?.message ?? "").toMatch(/fingerprint mismatch/i)
        }
        expect(serverA.reqCount()).toBe(before)
    })

    it('isolates concurrent ops in separate context scopes — no cross-context bleed', async () => {
        const client = createClient(PingApi, {url: ""})
        const callA = inScope(
            {tlsPin: {host: "127.0.0.1", port: serverA.port, fingerprint256: serverA.fingerprint256}},
            () => client.ping({msg: "a"}),
        )
        const callB = inScope(
            {tlsPin: {host: "127.0.0.1", port: serverB.port, fingerprint256: serverB.fingerprint256}},
            () => client.ping({msg: "b"}),
        )
        const [resA, resB] = await Promise.all([callA, callB])
        expect(resA.msg).toBe("from-A")
        expect(resB.msg).toBe("from-B")
    })

    it('pools one agent per fingerprint; invalidate drops the pooled sockets', async () => {
        // Dedicated server with a fresh fingerprint — the agent cache is module-global, so a
        // fingerprint dialed by another test would already have a pooled socket.
        const c = genCert(dir, "serverC")
        const serverC = await startServer(c.cert, c.key, "from-C")
        try {
            const client = createClient(PingApi, {url: ""})
            const pin = {tlsPin: {host: "127.0.0.1", port: serverC.port, fingerprint256: serverC.fingerprint256}}
            await inScope(pin, () => client.ping({msg: "1"}))
            await inScope(pin, () => client.ping({msg: "2"}))
            // keepAlive + same fingerprint → the second sequential request reuses one socket.
            expect(serverC.connCount()).toBe(1)

            invalidateTlsPinAgent(serverC.fingerprint256)
            await inScope(pin, () => client.ping({msg: "3"}))
            expect(serverC.connCount()).toBe(2)
        } finally {
            await serverC.close()
        }
    })

    it('pins via client config (connectionSettings) — no context key needed', async () => {
        const PublicApi = new GGHttpSchema({
            contract: PingContract,
            pathPrefix: "api/ping",
            routes: {ping: GGRpc.POST("ping")},
        })
        const client = createClient(PublicApi, {
            url: "",
            connectionSettings: {tlsPin: {host: "127.0.0.1", port: serverA.port, fingerprint256: serverA.fingerprint256}},
        })
        const res = await client.ping({msg: "hi"})
        expect(res.msg).toBe("from-A")
    })

    it('middleware overlays client config — the .set() pin wins', async () => {
        const client = createClient(PingApi, {
            url: "",
            // config defaults to server A, but the in-scope pin targets server B and must win.
            connectionSettings: {tlsPin: {host: "127.0.0.1", port: serverA.port, fingerprint256: serverA.fingerprint256}},
        })
        const res = await inScope(
            {tlsPin: {host: "127.0.0.1", port: serverB.port, fingerprint256: serverB.fingerprint256}},
            () => client.ping({msg: "hi"}),
        )
        expect(res.msg).toBe("from-B")
    })

    it('falls back to fetch when no pin is set', async () => {
        const fetchSpy = vi.fn(async () => new Response(
            JSON.stringify({success: true, type: "OK", data: {msg: "fetched"}}),
            {status: 200, headers: {"content-type": "application/json"}},
        ))
        vi.stubGlobal("fetch", fetchSpy)
        const client = createClient(PingApi, {url: "http://example.test"})
        const res = await client.ping({msg: "hi"})
        expect(res.msg).toBe("fetched")
        expect(fetchSpy).toHaveBeenCalledOnce()
    })

    it('throws in the browser when settings are present, but not when absent', async () => {
        vi.stubGlobal("window", {document: {}})

        const pinnedClient = createClient(PingApi, {
            url: "",
            connectionSettings: {tlsPin: {host: "127.0.0.1", port: serverA.port, fingerprint256: serverA.fingerprint256}},
        })
        const res = await pinnedClient.ping({msg: "hi"}).asResult()
        expect(res.success).toBe(false)
        if (res instanceof SERVER_ERROR) {
            expect(res.context?.displayMessage ?? "").toMatch(/node-only/i)
        }

        // No settings set → behaves like a normal fetch client even in the browser.
        const fetchSpy = vi.fn(async () => new Response(
            JSON.stringify({success: true, type: "OK", data: {msg: "fetched"}}),
            {status: 200, headers: {"content-type": "application/json"}},
        ))
        vi.stubGlobal("fetch", fetchSpy)
        const plainClient = createClient(PingApi, {url: "http://example.test"})
        const ok = await plainClient.ping({msg: "hi"})
        expect(ok.msg).toBe("fetched")
    })
})
