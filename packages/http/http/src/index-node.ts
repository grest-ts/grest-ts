import "./_dedupCheck";
// Register server RPC codec factory (must be before other exports that use it)
import {_registerRpcServerCodecFactory} from "./rpc/GGHttpRouteRPC";
import {GGRpcResponseBuilder} from "./rpc/RpcResponse/GGRpcResponseBuilder";
import {GGRpcRequestParser} from "./rpc/RpcRequest/GGRpcRequestParser";
_registerRpcServerCodecFactory((method, path, config) => ({
    parseRequest: new GGRpcRequestParser(method, path, config).parseRequest,
    sendResponse: new GGRpcResponseBuilder(config).sendResponse
}));

// Metrics
export * from "./server/GGHttpMetrics";

// Context
export * from "./server/GG_HTTP_REQUEST";
export * from "./server/GG_PERMISSIONS";

// API Schema
export * from "./schema/GGHttpSchema";
export * from "./schema/httpSchema";
export * from "./schema/GGCookie";
export * from "./rpc/GGHttpRouteRPC";
export * from "./rpc/openApiSuccessResponse";
export * from "./rpc/openApiHelpers";
export * from "./rpc/RpcRequest/GGRpcRequestBuilder";
export * from "./rpc/RpcRequest/GGRpcRequestParser";
export * from "./rpc/RpcResponse/GGRpcResponseBuilder";
export * from "./rpc/RpcResponse/GGRpcResponseParser";

// Server (convenience builder)
export * from "./server/GGHttp";
export * from "./server/GGHttp";
export * from "./server/GGHttpServer";
export * from "./server/GG_HTTP_SERVER";
export * from "./server/applyResponseMiddleware";

// Client
export * from "./client/GGHttpSchema.createClient";
export * from "./server/GGHttpSchema.startServer";


// Extensions
import "./client/GGHttpSchema.createClient";
import "./server/GGHttpSchema.startServer";
