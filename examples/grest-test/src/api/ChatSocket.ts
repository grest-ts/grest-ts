import {GGDuplexExtendableContract} from "@grest-ts/schema"
import {GGWebSocketExtendableSchema} from "@grest-ts/websocket"

/**
 * One WebSocket connection ("ws/chat"), declared once. Feature modules contribute their own
 * methods via `ChatContract.extend(...)` from their own files (see ChatMessagingApi /
 * ChatPresenceApi) and multiplex over this single socket — no central method list.
 */
export const ChatContract = new GGDuplexExtendableContract("Chat", {
    connect: {},
})

export const ChatSocket = new GGWebSocketExtendableSchema({
    contract: ChatContract,
    path: "ws/chat",
})
