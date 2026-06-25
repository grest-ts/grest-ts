import "./_dedupCheck";
// Type helpers
export * from "./socket/WebSocketTypes";

// Context
export * from "./server/GG_WS_CONNECTION";
export * from "./server/GG_WS_MESSAGE";

// Core
export * from "./socket/GGSocket";

// API Schema
export {GGWebSocketSchema} from "./schema/GGWebSocketSchema";
export type {GGWebSocketSchemaConfig} from "./schema/GGWebSocketSchema";
export {GGRawWebSocketSchema} from "./schema/GGRawWebSocketSchema";
export type {GGRawWebSocketSchemaConfig} from "./schema/GGRawWebSocketSchema";

// Client
export * from "./client/GGWebSocketSchema.createClient";
export * from "./client/GGRawWebSocketSchema.createClient";
export * from "./client/GGWsLogMode";

// Extensions
import "./client/GGWebSocketSchema.createClient";
import "./client/GGRawWebSocketSchema.createClient";
