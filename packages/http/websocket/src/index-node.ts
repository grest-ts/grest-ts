import "./_dedupCheck";
// Type helpers
export * from "./socket/WebSocketTypes";

// Metrics
export * from "./server/GGWebSocketMetrics";

// Context
export * from "./server/GG_WS_CONNECTION";
export * from "./server/GG_WS_MESSAGE";

// Core
export * from "./socket/GGSocket";
export * from "./socket/GGRawSocket";

// API Schema
export {GGWebSocketSchema} from "./schema/GGWebSocketSchema";
export type {GGWebSocketSchemaConfig} from "./schema/GGWebSocketSchema";
export {GGWebSocketExtendableSchema} from "./schema/GGWebSocketExtendableSchema";
export type {GGWebSocketExtendableSchemaConfig} from "./schema/GGWebSocketExtendableSchema";
export {GGRawWebSocketSchema} from "./schema/GGRawWebSocketSchema";
export type {GGRawWebSocketSchemaConfig} from "./schema/GGRawWebSocketSchema";
export {assertValidSocketPath, wildcardPathBase} from "./schema/socketPath";

// Server
export type {GGWsUpgrade, GGServerHeartbeatOption} from "./server/GGSocketServer";
export * from "./server/GGWebSocketSchema.startServer";
export * from "./server/GGRawWebSocketSchema.startServer";

// Client
export * from "./client/GGWebSocketSchema.createClient";
export * from "./client/GGRawWebSocketSchema.createClient";
export * from "./client/GGWsLogMode";

// Extensions
import "./server/GGHttp.ws";
import "./client/GGWebSocketSchema.createClient";
import "./client/GGRawWebSocketSchema.createClient";
import "./client/GGWebSocketSchema.createClient.node";
