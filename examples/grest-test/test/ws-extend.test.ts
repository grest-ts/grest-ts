import {GGWebSocketSchema, GGWebSocketExtendableSchema} from "@grest-ts/websocket"
import {GGDuplexContract, GGDuplexExtendableContract, IsString, SERVER_ERROR} from "@grest-ts/schema"

const ChatContract = new GGDuplexExtendableContract("Chat", {connect: {}})
const ChatSocket = new GGWebSocketExtendableSchema({contract: ChatContract, path: "ws/chat"})

const Messaging = ChatContract.extend("Messaging", {
    clientToServer: {send: {input: IsString, success: IsString, errors: [SERVER_ERROR]}},
    serverToClient: {message: {input: IsString}},
})

describe("GGWebSocketExtendableSchema.extend", () => {

    test("produces a GGWebSocketSchema inheriting path and sharing the group", () => {
        const socket = ChatSocket.extend(Messaging)
        expect(socket).toBeInstanceOf(GGWebSocketSchema)
        expect(socket.name).toBe("Messaging")
        expect(socket.path).toBe("ws/chat")
        expect(socket.group).toBe(ChatSocket)
    })

    test("siblings of one anchor share the same group", () => {
        const Presence = ChatContract.extend("Presence", {clientToServer: {ping: {errors: [SERVER_ERROR]}}})
        expect(ChatSocket.extend(Messaging).group).toBe(ChatSocket.extend(Presence).group)
    })

    test("rejects a contract created from a different group", () => {
        const Other = new GGDuplexExtendableContract("Other", {connect: {}})
        const foreign = Other.extend("Foreign", {clientToServer: {x: {errors: [SERVER_ERROR]}}})
        expect(() => ChatSocket.extend(foreign)).toThrow(/was not created from this group/)
    })

    test("rejects a plain GGDuplexContract with no parent", () => {
        const plain = new GGDuplexContract("Plain", {connect: {}, clientToServer: {}, serverToClient: {}})
        expect(() => ChatSocket.extend(plain)).toThrow(/was not created from this group/)
    })
})
