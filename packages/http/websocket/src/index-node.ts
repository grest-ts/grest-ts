import "./_dedupCheck";
import "./client/GGSocketPool.node";
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
export {defineSocketContract, webSocketSchema} from "./schema/webSocketSchema";
export type {GGSocketContract, GGSocketContractMethods, GGRawSocketContract, GGRawSocketContractDef} from "./schema/webSocketSchema";
export {GGWebSocketSchema} from "./schema/GGWebSocketSchema";
export {GGRawWebSocketSchema} from "./schema/GGRawWebSocketSchema";

// Server
export type {GGWsUpgrade, GGServerHeartbeatOption} from "./server/GGSocketServer";
export * from "./server/GGWebSocketSchema.startServer";
export * from "./server/GGRawWebSocketSchema.startServer";

// Client
export * from "./client/GGWebSocketSchema.createClient";
export * from "./client/GGRawWebSocketSchema.createClient";
export * from "./client/GGWsLogMode";

// Extensions
import "./server/GGWebSocketSchema.startServer";
import "./server/GGRawWebSocketSchema.startServer";
import "./client/GGWebSocketSchema.createClient";
import "./client/GGRawWebSocketSchema.createClient";
import "./client/GGWebSocketSchema.createClient.node";
