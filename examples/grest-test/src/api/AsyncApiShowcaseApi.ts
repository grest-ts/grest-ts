/**
 * AsyncApiShowcaseApi — rich WebSocket API definition used as a demo and snapshot anchor.
 *
 * Demonstrates:
 *   - Request/response (clientToServer with success)
 *   - Fire-and-forget (clientToServer without success)
 *   - Server push (serverToClient)
 *   - Bearer auth via middleware headers
 *   - Named schemas with docs ($ref extraction)
 *   - Error types on operations
 *   - Multiple contracts on one server
 */

import {GGWebSocketSchema, GGRawWebSocketSchema} from "@grest-ts/websocket";
import {
    GGDuplexContract, GGRawSocketContract,
    IsString, IsNumber, IsBoolean, IsArray, IsObject, IsLiteral,
    IsDiscriminated, VALIDATION_ERROR, SERVER_ERROR, ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export const ROOM_NOT_FOUND = ERROR.define("ROOM_NOT_FOUND", 404);
export const MESSAGE_TOO_LONG = ERROR.define("MESSAGE_TOO_LONG", 422);

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

export const IsChatMessage = IsObject({
    messageId: IsString.nonEmpty.docs({example: "msg_abc123"}),
    roomId: IsString.nonEmpty,
    userId: IsString.nonEmpty.docs({example: "usr_abc123"}),
    text: IsString.nonEmpty.maxLength(2000).docs({description: "Message content"}),
    timestamp: IsNumber.docs({description: "Unix timestamp (ms)", example: 1700000000000}),
}).docs({title: "Chat message", description: "A message in a chat room"});

export const IsChatRoom = IsObject({
    roomId: IsString.nonEmpty.docs({example: "room_general"}),
    name: IsString.nonEmpty.docs({example: "general"}),
    participantCount: IsNumber.docs({description: "Number of active participants"}),
}).docs({title: "Chat room"});

export const IsPresenceUpdate = IsDiscriminated("status", {
    online:  IsObject({status: IsLiteral("online"),  userId: IsString.nonEmpty, roomId: IsString.nonEmpty}),
    offline: IsObject({status: IsLiteral("offline"), userId: IsString.nonEmpty, roomId: IsString.nonEmpty}),
    typing:  IsObject({status: IsLiteral("typing"),  userId: IsString.nonEmpty, roomId: IsString.nonEmpty}),
}).docs({title: "Presence update", description: "User presence status change in a room"});

// ---------------------------------------------------------------------------
// Chat contract — demonstrates request/response and fire-and-forget
// ---------------------------------------------------------------------------

export const ChatContract = new GGDuplexContract("ChatApi", {
    connect: {},
    clientToServer: {
        // REQUEST/RESPONSE — client sends, expects a reply
        sendMessage: {
            input: IsObject({
                roomId: IsString.nonEmpty,
                text: IsString.nonEmpty.maxLength(2000).docs({description: "Message text to send"}),
            }).docs({title: "Send message request"}),
            success: IsChatMessage,
            errors: [VALIDATION_ERROR, ROOM_NOT_FOUND, MESSAGE_TOO_LONG, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        getRooms: {
            // no input — client requests list of rooms
            success: IsArray(IsChatRoom),
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        // FIRE-AND-FORGET — client sends, no response expected
        setTyping: {
            input: IsObject({
                roomId: IsString.nonEmpty,
                typing: IsBoolean,
            }).docs({description: "Notify the server the user started/stopped typing"}),
            permission: GG_NO_PERMISSIONS
        },
        ping: {
            // no input, no response — keep-alive ping
        }
    },
    serverToClient: {
        // SERVER PUSH — server sends to client unprompted
        onMessage: {
            input: IsChatMessage,
            permission: GG_NO_PERMISSIONS
        },
        onPresence: {
            input: IsPresenceUpdate,
            permission: GG_NO_PERMISSIONS
        },
        onRoomUpdated: {
            input: IsChatRoom,
            permission: GG_NO_PERMISSIONS
        },
    }
});

// ---------------------------------------------------------------------------
// Notification contract — demonstrates server-push only
// ---------------------------------------------------------------------------

export const NotificationContract = new GGDuplexContract("NotificationApi", {
    connect: {},
    clientToServer: {
        subscribe: {
            input: IsObject({
                topics: IsArray(IsString.nonEmpty).docs({description: "Topic names to subscribe to", example: ["orders", "inventory"]})
            }).docs({description: "Subscribe to notification topics"}),
            success: IsObject({subscribed: IsArray(IsString.nonEmpty)}).docs({description: "Confirmed subscriptions"}),
            errors: [VALIDATION_ERROR, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        unsubscribe: {
            input: IsObject({topics: IsArray(IsString.nonEmpty)}),
            // fire-and-forget
            permission: GG_NO_PERMISSIONS
        }
    },
    serverToClient: {
        onNotification: {
            input: IsObject({
                topic: IsString.nonEmpty,
                title: IsString.nonEmpty.docs({example: "Order shipped"}),
                body: IsString.nonEmpty.docs({example: "Your order #1234 has been shipped"}),
                timestamp: IsNumber,
            }).docs({title: "Notification", description: "A notification event for a subscribed topic"}),
            permission: GG_NO_PERMISSIONS
        }
    }
});

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

export const AsyncApiBearerAuth = {
    headers: {
        "authorization": IsString.orUndefined.docs({title: "Bearer token", format: "bearer", description: "JWT access token for WebSocket auth"})
    }
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ChatApiSchema = new GGWebSocketSchema({
    contract: ChatContract,
    path: "ws/chat",
    use: [AsyncApiBearerAuth],
});

export const NotificationApiSchema = new GGWebSocketSchema({
    contract: NotificationContract,
    path: "ws/notifications",
    use: [AsyncApiBearerAuth],
});

// ---------------------------------------------------------------------------
// Raw byte-stream contracts — opaque wire, no per-message contract
// ---------------------------------------------------------------------------

export const LogStreamContract = new GGRawSocketContract("LogStreamApi", {
    connect: {
        input: IsObject({
            service: IsString.nonEmpty.docs({title: "Service name", description: "Service whose logs to stream", example: "billing"}),
            level: IsString.orUndefined.docs({title: "Min log level", example: "warn"}),
        }).docs({title: "Log stream connect", description: "Handshake query selecting which log stream to tail"}),
        errors: [VALIDATION_ERROR, SERVER_ERROR],
    },
});

export const LogStreamApiSchema = new GGRawWebSocketSchema({
    contract: LogStreamContract,
    path: "ws/raw-logs",
    use: [AsyncApiBearerAuth],
});

export const TerminalProxyContract = new GGRawSocketContract("TerminalProxyApi", {
    connect: {errors: [SERVER_ERROR]},
    customClient: true,
});

export const TerminalProxyApiSchema = new GGRawWebSocketSchema({
    contract: TerminalProxyContract,
    path: "/raw-terminal/*",
});
