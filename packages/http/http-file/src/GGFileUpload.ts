import {HttpMethod} from "@grest-ts/common"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec, GGRpcResponseParser, GGRpcResponseBuilder} from "@grest-ts/http"
import {GGFileUploadRequestBuilder} from "./GGFileUploadRequestBuilder";
import {GGFileUploadRequestParser} from "./GGFileUploadRequestParser";

export const GGFileUpload = {
    POST: (path: string) => new GGFileUploadCodec("POST", path),
}

class GGFileUploadCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string
    public readonly responseHeaders: readonly string[] = []

    constructor(method: HttpMethod, path: string) {
        this.method = method
        this.path = path
    }

    public createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec {
        this.assertHasNonJsonData(config.contract);
        return {
            createRequest: new GGFileUploadRequestBuilder(this.method, this.path, config).createRequest,
            parseResponse: new GGRpcResponseParser(config).parseResponse
        }
    }

    public createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec {
        this.assertHasNonJsonData(config.contract);
        return {
            parseRequest: new GGFileUploadRequestParser(this.method, this.path, config).parseRequest,
            sendResponse: new GGRpcResponseBuilder(config).sendResponse
        }
    }

    private assertHasNonJsonData(contract: { input?: { toCompilerDef(): { hasNonJsonData?: boolean } } }): void {
        if (!contract.input?.toCompilerDef().hasNonJsonData) {
            throw new Error(`GGFileUpload.POST("${this.path}") is used on a route with no non-JSON data (e.g. files). Use GGRpc.POST instead.`);
        }
    }
}
