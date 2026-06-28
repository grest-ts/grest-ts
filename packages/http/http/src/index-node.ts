import "./_dedupCheck";
// Register server RPC codec factory (must be before other exports that use it)
import {_registerRpcServerCodecFactory} from "./rpc/GGHttpRouteRPC";
import {GGRpcResponseBuilder} from "./rpc/RpcResponse/GGRpcResponseBuilder";
import {GGRpcRequestParser} from "./rpc/RpcRequest/GGRpcRequestParser";

_registerRpcServerCodecFactory((method, path, config) => {
    const parser = new GGRpcRequestParser(method, path, config);
    return {
        readRequest: parser.readRequest,
        validateInput: parser.validateInput,
        sendResponse: new GGRpcResponseBuilder(config).sendResponse
    };
});

// Metrics
export * from "./server/GGHttpMetrics";

// Context
export * from "./server/GG_HTTP_REQUEST";

// API Schema
export * from "./schema/GGHttpSchema";
export * from "./schema/GGCookie";
export * from "./schema/GGWireContextKey";
export * from "./schema/GGWireContextKey.node";
export * from "./schema/GGHeader";
export * from "./schema/GGConnectionSettingsKey";
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
export * from "./server/applyRequestMiddleware";
export * from "./schema/GGHttpPermissionsChecker";

// Client
export * from "./client/GGContextKeySynchronizer";
export * from "./client/GGHttpSchema.createClient";
export * from "./client/nodeConnectionTransport.node";
export * from "./server/GGHttpSchema.startServer";


// Extensions
import "./client/GGHttpSchema.createClient";
import "./client/GGHttpSchema.createClient.node";
import "./schema/GGWireContextKey.node";
