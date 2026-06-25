import {GGWebSocketSchema} from "@grest-ts/websocket"
import {assertValidSocketPath} from "@grest-ts/websocket/internal"
import {GGDuplexContract, IsString, SERVER_ERROR} from "@grest-ts/schema"

const Contract = new GGDuplexContract("WsPathProbe", {
    connect: {},
    clientToServer: {ping: {success: IsString, errors: [SERVER_ERROR]}},
    serverToClient: {},
})

describe("GGWebSocketSchema path validation", () => {

    test.each(["/socket", "ws/wire-live", "/a/b/c"])("accepts valid path %j", (path) => {
        expect(() => new GGWebSocketSchema({contract: Contract, path})).not.toThrow()
        expect(() => assertValidSocketPath(path, "X")).not.toThrow()
    })

    test("rejects an empty path", () => {
        expect(() => new GGWebSocketSchema({contract: Contract, path: ""})).toThrow(/invalid path/i)
    })

    test.each(["", "ws/ has space", "socket?token=x", "socket#frag"])("rejects malformed path %j", (path) => {
        expect(() => new GGWebSocketSchema({contract: Contract, path})).toThrow(/invalid path/i)
    })

    test("error names the api and the offending path", () => {
        expect(() => assertValidSocketPath("bad?x", "MyWsApi"))
            .toThrow(/MyWsApi.*"bad\?x"/)
    })
})
