import {assertValidSocketPath, webSocketSchema} from "@grest-ts/websocket"
import {IsString, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"

const WsPathProbeMethods = {
    clientToServer: {ping: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS}},
    serverToClient: {},
}

describe("webSocketSchema path validation", () => {

    test.each(["/socket", "ws/wire-live", "/a/b/c"])("accepts valid path %j", (path) => {
        expect(() => webSocketSchema("WsPathProbe").path(path).messages(WsPathProbeMethods)).not.toThrow()
        expect(() => assertValidSocketPath(path, "X")).not.toThrow()
    })

    test("rejects when no path is set (empty default)", () => {
        expect(() => webSocketSchema("WsPathProbe").messages(WsPathProbeMethods)).toThrow(/invalid path/i)
    })

    test.each(["", "ws/ has space", "socket?token=x", "socket#frag"])("rejects malformed path %j", (path) => {
        expect(() => webSocketSchema("WsPathProbe").path(path).messages(WsPathProbeMethods)).toThrow(/invalid path/i)
    })

    test("error names the api and the offending path", () => {
        expect(() => assertValidSocketPath("bad?x", "MyWsApi"))
            .toThrow(/MyWsApi.*"bad\?x"/)
    })
})
