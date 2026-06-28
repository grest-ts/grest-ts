import {describe, it, expect, beforeAll, afterAll, afterEach, vi} from 'vitest'
import https from 'node:https'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {X509Certificate} from 'node:crypto'
import {GGContractClass, IsObject, IsString, SERVER_ERROR} from '@grest-ts/schema'
import {GGContext, type GGConnectionSettings} from '@grest-ts/context'
import {GGHttpSchema} from '../schema/GGHttpSchema'
import {GGRpc} from '../rpc/GGHttpRouteRPC'
import {createClient} from './GGHttpSchema.createClient'
import {GGConnectionSettingsKey} from '../schema/GGConnectionSettingsKey'
import {invalidateTlsPinAgent} from './nodeConnectionTransport.node'
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

function openssl(...args: string[]): void {
    execFileSync("openssl", args, {stdio: "ignore"})
}

function genCert(dir: string, name: string): {cert: string; key: string} {
    const certPath = join(dir, `${name}.cert.pem`)
    const keyPath = join(dir, `${name}.key.pem`)
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath, "-out", certPath, "-subj", `/CN=${name}`)
    return {cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8")}
}

interface TestCa {keyPath: string; crtPath: string; crt: string}

function genCa(dir: string, name: string): TestCa {
    const keyPath = join(dir, `${name}.ca.key`)
    const crtPath = join(dir, `${name}.ca.crt`)
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath, "-out", crtPath, "-subj", `/CN=${name}-ca`)
    return {keyPath, crtPath, crt: readFileSync(crtPath, "utf8")}
}

function genSignedCert(dir: string, name: string, ca: TestCa, sanIp?: string): {cert: string; key: string} {
    const keyPath = join(dir, `${name}.key`)
    const csrPath = join(dir, `${name}.csr`)
    const crtPath = join(dir, `${name}.crt`)
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", csrPath, "-subj", `/CN=${name}`)
    const args = ["x509", "-req", "-in", csrPath, "-CA", ca.crtPath, "-CAkey", ca.keyPath, "-CAcreateserial", "-days", "1", "-out", crtPath]
    if (sanIp) {
        const extPath = join(dir, `${name}.ext`)
        writeFileSync(extPath, `subjectAltName=IP:${sanIp}\n`)
        args.push("-extfile", extPath)
    }
    openssl(...args)
    return {cert: readFileSync(crtPath, "utf8"), key: readFileSync(keyPath, "utf8")}
}

async function startServer(cert: string, key: string, replyMsg: string, extra: https.ServerOptions = {}): Promise<TestServer> {
    let reqCount = 0
    let connCount = 0
    const server = https.createServer({cert, key, ...extra}, (_req, res) => {
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
            {host: "127.0.0.1", port: serverA.port, tlsPin: {fingerprint256: serverA.fingerprint256}},
            () => client.ping({msg: "hi"}),
        )
        expect(res.msg).toBe("from-A")
    })

    it('rejects a fingerprint mismatch before any request bytes flow', async () => {
        const before = serverA.reqCount()
        const client = createClient(PingApi, {url: ""})
        const bogus = "a".repeat(64)
        const res = await inScope(
            {host: "127.0.0.1", port: serverA.port, tlsPin: {fingerprint256: bogus}},
            () => client.ping({msg: "hi"}).asResult(),
        )
        expect(res.success).toBe(false)
        expect(res).toBeInstanceOf(SERVER_ERROR)
        if (res instanceof SERVER_ERROR) {
            // fetch surfaces a connector failure as `TypeError: fetch failed` with the real cause attached.
            const original = res.getDebugContext()?.originalError as (Error & {cause?: Error}) | undefined
            const chain = `${original?.message ?? ""} ${original?.cause?.message ?? ""}`
            expect(chain).toMatch(/fingerprint mismatch/i)
        }
        expect(serverA.reqCount()).toBe(before)
    })

    it('isolates concurrent ops in separate context scopes — no cross-context bleed', async () => {
        const client = createClient(PingApi, {url: ""})
        const callA = inScope(
            {host: "127.0.0.1", port: serverA.port, tlsPin: {fingerprint256: serverA.fingerprint256}},
            () => client.ping({msg: "a"}),
        )
        const callB = inScope(
            {host: "127.0.0.1", port: serverB.port, tlsPin: {fingerprint256: serverB.fingerprint256}},
            () => client.ping({msg: "b"}),
        )
        const [resA, resB] = await Promise.all([callA, callB])
        expect(resA.msg).toBe("from-A")
        expect(resB.msg).toBe("from-B")
    })

    it('reuses a pooled connection per fingerprint; invalidate forces a fresh one', async () => {
        // Dedicated server with a fresh fingerprint — the agent cache is module-global, so a
        // fingerprint dialed by another test would already have a pooled socket.
        const c = genCert(dir, "serverC")
        const serverC = await startServer(c.cert, c.key, "from-C")
        try {
            const client = createClient(PingApi, {url: ""})
            const pin = {host: "127.0.0.1", port: serverC.port, tlsPin: {fingerprint256: serverC.fingerprint256}}
            await inScope(pin, () => client.ping({msg: "1"}))
            await new Promise(r => setTimeout(r, 150))   // let undici return the socket to the pool
            const afterFirst = serverC.connCount()
            await inScope(pin, () => client.ping({msg: "2"}))
            expect(serverC.connCount()).toBe(afterFirst)   // same fingerprint → pooled socket reused

            invalidateTlsPinAgent(serverC.fingerprint256)
            await inScope(pin, () => client.ping({msg: "3"}))
            expect(serverC.connCount()).toBe(afterFirst + 1)   // fresh agent → new connection
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
            connectionSettings: {host: "127.0.0.1", port: serverA.port, tlsPin: {fingerprint256: serverA.fingerprint256}},
        })
        const res = await client.ping({msg: "hi"})
        expect(res.msg).toBe("from-A")
    })

    it('middleware overlays client config — the .set() pin wins', async () => {
        const client = createClient(PingApi, {
            url: "",
            // config defaults to server A, but the in-scope pin targets server B and must win.
            connectionSettings: {host: "127.0.0.1", port: serverA.port, tlsPin: {fingerprint256: serverA.fingerprint256}},
        })
        const res = await inScope(
            {host: "127.0.0.1", port: serverB.port, tlsPin: {fingerprint256: serverB.fingerprint256}},
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
            connectionSettings: {host: "127.0.0.1", port: serverA.port, tlsPin: {fingerprint256: serverA.fingerprint256}},
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

describe('connection settings — custom CA & mTLS', () => {

    let dir: string
    let srvCa: TestCa
    let server: {cert: string; key: string}
    let clientPem: {cert: string; key: string}
    let caServer: TestServer
    let mtlsServer: TestServer

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), "gg-tls-"))
        srvCa = genCa(dir, "srv")
        server = genSignedCert(dir, "server", srvCa, "127.0.0.1")   // SAN so hostname verification passes
        const clientCa = genCa(dir, "client")
        clientPem = genSignedCert(dir, "clientcert", clientCa)
        caServer = await startServer(server.cert, server.key, "from-ca-server")
        mtlsServer = await startServer(server.cert, server.key, "from-mtls-server", {
            requestCert: true,
            rejectUnauthorized: true,
            ca: clientCa.crt,   // verify the client cert against this CA
        })
    })

    afterAll(async () => {
        await caServer?.close()
        await mtlsServer?.close()
        if (dir) rmSync(dir, {recursive: true, force: true})
    })

    it('verifies the server against a custom ca', async () => {
        const client = createClient(PingApi, {
            url: "",
            connectionSettings: {host: "127.0.0.1", port: caServer.port, ca: srvCa.crt},
        })
        const res = await client.ping({msg: "hi"})
        expect(res.msg).toBe("from-ca-server")
    })

    it('rejects a server signed by an untrusted ca (no ca provided)', async () => {
        const client = createClient(PingApi, {url: `https://127.0.0.1:${caServer.port}`})
        const res = await client.ping({msg: "hi"}).asResult()
        expect(res.success).toBe(false)
    })

    it('presents a client certificate for mTLS', async () => {
        const client = createClient(PingApi, {
            url: "",
            connectionSettings: {host: "127.0.0.1", port: mtlsServer.port, ca: srvCa.crt, clientCert: clientPem},
        })
        const res = await client.ping({msg: "hi"})
        expect(res.msg).toBe("from-mtls-server")
    })

    it('mTLS server rejects a client with no certificate', async () => {
        const client = createClient(PingApi, {
            url: "",
            connectionSettings: {host: "127.0.0.1", port: mtlsServer.port, ca: srvCa.crt},
        })
        const res = await client.ping({msg: "hi"}).asResult()
        expect(res.success).toBe(false)
    })
})
