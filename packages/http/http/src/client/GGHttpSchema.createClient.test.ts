import {describe, it, expect, vi, afterEach} from 'vitest'
import {GGContractClass, IsObject, IsString, SERVER_ERROR} from '@grest-ts/schema'
import {httpSchema} from '../schema/httpSchema'
import {GGRpc} from '../rpc/GGHttpRouteRPC'
import {createClient, _registerDiscoveryUrlResolver} from './GGHttpSchema.createClient'
import {discoveryUrlResolver} from './GGHttpSchema.createClient.node'

const PingContract = new GGContractClass("CreateClientTestApi", {
    ping: {
        input: IsObject({msg: IsString}),
        success: IsObject({msg: IsString}),
        errors: [SERVER_ERROR],
    },
})

const PingApi = httpSchema(PingContract)
    .pathPrefix("api/ping")
    .routes({ping: GGRpc.POST("ping")})

function okResponse(): Response {
    return new Response(JSON.stringify({success: true, type: "OK", data: {msg: "pong"}}), {
        status: 200, headers: {"content-type": "application/json"},
    })
}

// URL-less clients resolve their base URL through the resolver hook — attached
// node-side only, so the browser bundle never references @grest-ts/discovery.
describe('createClient discovery url resolution', () => {

    afterEach(() => {
        _registerDiscoveryUrlResolver(discoveryUrlResolver)
        vi.unstubAllGlobals()
    })

    it('url-less client resolves the base URL via the registered resolver', async () => {
        const resolve = vi.fn(async (apiName: string) => `http://resolved-${apiName}:1234`)
        _registerDiscoveryUrlResolver(resolve)
        let calledUrl = ""
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            calledUrl = url
            return okResponse()
        }))
        const client = createClient(PingApi, {})
        const res = await client.ping({msg: "hi"})
        expect(res.msg).toBe("pong")
        expect(resolve).toHaveBeenCalledWith("CreateClientTestApi")
        expect(calledUrl).toBe("http://resolved-CreateClientTestApi:1234/api/ping/ping")
    })

    it('resolver failure surfaces as SERVER_ERROR "Service discovery failed"', async () => {
        _registerDiscoveryUrlResolver(async () => { throw new Error("boom") })
        const client = createClient(PingApi, {})
        const res = await client.ping({msg: "hi"}).asResult()
        expect(res.success).toBe(false)
        expect(res).toBeInstanceOf(SERVER_ERROR)
        if (res instanceof SERVER_ERROR) {
            expect(res.context?.displayMessage).toBe("Service discovery failed")
        }
    })

    it('explicit url skips the resolver entirely', async () => {
        const resolve = vi.fn(async () => "http://never")
        _registerDiscoveryUrlResolver(resolve)
        vi.stubGlobal("fetch", vi.fn(async () => okResponse()))
        const client = createClient(PingApi, {url: "http://explicit:1"})
        const res = await client.ping({msg: "hi"})
        expect(res.msg).toBe("pong")
        expect(resolve).not.toHaveBeenCalled()
    })
})
