import "./_dedupCheck";
// Type helpers
export * from "./socket/WebSocketTypes";

// Context
export * from "./server/GG_WS_CONNECTION";
export * from "./server/GG_WS_MESSAGE";

// Core
export * from "./socket/GGSocket";
export * from "./socket/SocketAdapter";

// API Schema
export * from "./schema/webSocketSchema";
export * from "./schema/GGWebSocketSchema";
export * from "./schema/GGRawWebSocketSchema";

// Client
export * from "./client/GGSocketPool";
export * from "./client/reconnectConnector";
export * from "./client/GGWebSocketSchema.createClient";
export * from "./client/GGRawWebSocketSchema.createClient";
export * from "./client/GGWsLogMode";

// Extensions
import "./client/GGWebSocketSchema.createClient";
import "./client/GGRawWebSocketSchema.createClient";