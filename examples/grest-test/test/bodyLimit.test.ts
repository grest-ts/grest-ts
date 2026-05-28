import http from "node:http"
import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {GGContractClass, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"
import {BodyLimitRuntime} from "../src/BodyLimitRuntime"

function urlFor(apiName: string): string {
    return GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(apiName)
}

// Build a JSON body `{"data":"x…x"}` whose total byte length is ~`bytes`.
function jsonOfSize(bytes: number): string {
    const overhead = `{"data":""}`.length
    return `{"data":"${"x".repeat(Math.max(0, bytes - overhead))}"}`
}

async function postString(path: string, body: string): Promise<Response> {
    return fetch(`${urlFor("BodyLimit")}/${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body,
    })
}

describe("HTTP request body size limit", () => {
    GGTest.startInline(BodyLimitRuntime)

    test("under-limit body is accepted", async () => {
        const res = await postString("api/body-limit/echo-default", jsonOfSize(1000))
        expect(res.status).toBe(200)
        expect(((await res.json()) as any).success).toBe(true)
    })

    test("over-default-limit body (declared Content-Length) → 413 PAYLOAD_TOO_LARGE", async () => {
        const res = await postString("api/body-limit/echo-default", jsonOfSize(1024 * 1024 + 5000))
        expect(res.status).toBe(413)
        expect(((await res.json()) as any).type).toBe("PAYLOAD_TOO_LARGE")
    })

    test("chunked body with no Content-Length is still capped by the streaming counter", async () => {
        // Transfer-Encoding: chunked, so there's no Content-Length to pre-check.
        // echoSmall caps at 1 KiB; the first 2 KiB chunk must trip the counter.
        const base = new URL(urlFor("BodyLimit"))
        const status = await new Promise<number>((resolve, reject) => {
            const req = http.request({
                hostname: base.hostname,
                port: base.port,
                path: "/api/body-limit/echo-small",
                method: "POST",
                headers: {"Content-Type": "application/json", "Transfer-Encoding": "chunked"},
            }, (res) => {
                res.resume()
                resolve(res.statusCode!)
                req.destroy()
            })
            req.on("error", (e) => reject(e))
            req.write("x".repeat(2048))
        })
        expect(status).toBe(413)
    })

    test("per-route maxBodyBytes raises the cap above the default", async () => {
        const body = jsonOfSize(2 * 1024 * 1024) // 2 MiB: over default (1 MiB), under echoBig (4 MiB)
        expect((await postString("api/body-limit/echo-default", body)).status).toBe(413)
        expect((await postString("api/body-limit/echo-big", body)).status).toBe(200)
    })

    test("invalid maxBodyBytes is rejected at contract-definition time", () => {
        expect(() => new GGContractClass("BadBodyLimit", {
            x: {input: IsObject({data: IsString}), success: IsString, errors: [SERVER_ERROR], maxBodyBytes: -1},
        })).toThrow(/maxBodyBytes/)
    })
})
