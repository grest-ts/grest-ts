import {assertValidSocketPath, defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {IsString, SERVER_ERROR} from "@grest-ts/schema"

const Contract = defineSocketContract("WsPathProbe", {
    clientToServer: {ping: {success: IsString, errors: [SERVER_ERROR]}},
    serverToClient: {},
})

describe("webSocketSchema path validation", () => {

    test.each(["/socket", "ws/wire-live", "/a/b/c"])("accepts valid path %j", (path) => {
        expect(() => webSocketSchema(Contract).path(path).done()).not.toThrow()
        expect(() => assertValidSocketPath(path, "X")).not.toThrow()
    })

    test("rejects when no path is set (empty default)", () => {
        expect(() => webSocketSchema(Contract).done()).toThrow(/invalid path/i)
    })

    test.each(["", "ws/ has space", "socket?token=x", "socket#frag"])("rejects malformed path %j", (path) => {
        expect(() => webSocketSchema(Contract).path(path).done()).toThrow(/invalid path/i)
    })

    test("error names the api and the offending path", () => {
        expect(() => assertValidSocketPath("bad?x", "MyWsApi"))
            .toThrow(/MyWsApi.*"bad\?x"/)
    })
})
