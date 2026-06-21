import "./_dedupCheck";
// Type helpers
export * from "./socket/WebSocketTypes";

// Context
export * from "./server/GG_WS_CONNECTION";
export * from "./server/GG_WS_MESSAGE";

// Core
export * from "./socket/GGSocket";
export * from "./socket/SocketAdapter";
export * from "./liveness/GGClientLiveness";

// API Schema
export * from "./schema/webSocketSchema";
export * from "./schema/GGWebSocketSchema";
export * from "./schema/rawSocketSchema";

// Client
export * from "./client/GGSocketPool";
export * from "./client/GGWebSocketSchema.createClient";
export * from "./client/GGRawWebSocketSchema.createRawClient";
export * from "./client/GGWsLogMode";

// Extensions
import "./client/GGWebSocketSchema.createClient";
import "./client/GGRawWebSocketSchema.createRawClient";