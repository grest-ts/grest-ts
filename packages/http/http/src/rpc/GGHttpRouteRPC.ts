import {HttpMethod} from "@grest-ts/common"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec} from "../schema/GGHttpSchema"
import {GGRpcRequestBuilder} from "./RpcRequest/GGRpcRequestBuilder";
import {GGRpcResponseParser} from "./RpcResponse/GGRpcResponseParser";

export type GGRpcServerCodecFactory = (method: HttpMethod, path: string, config: ClientHttpRouteToRpcTransformServerConfig) => ClientHttpRouteToRpcTransformServerCodec;

let _serverCodecFactory: GGRpcServerCodecFactory | undefined;

export function _registerRpcServerCodecFactory(factory: GGRpcServerCodecFactory): void {
    _serverCodecFactory = factory;
}

export const GGRpc = {
    GET: (path: string) => new GGHttpRpcCodec("GET", path),
    DELETE: (path: string) => new GGHttpRpcCodec("DELETE", path),
    POST: (path: string) => new GGHttpRpcCodec("POST", path),
    PUT: (path: string) => new GGHttpRpcCodec("PUT", path),
}

class GGHttpRpcCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string
    public readonly responseHeaders: readonly string[] = []

    constructor(method: HttpMethod, path: string) {
        this.method = method
        this.path = path
    }

    public createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec {
        return {
            createRequest: new GGRpcRequestBuilder(this.method, this.path, config).createRequest,
            parseResponse: new GGRpcResponseParser(config).parseResponse
        }
    }

    public createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec {
        if (!_serverCodecFactory) throw new Error("Server RPC codec not available. Ensure @grest-ts/http server entry is imported.");
        return _serverCodecFactory(this.method, this.path, config);
    }
}
