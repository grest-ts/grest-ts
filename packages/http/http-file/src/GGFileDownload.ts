import {HttpMethod} from "@grest-ts/common"
import {GGContractMethod, isNonJsonDef} from "@grest-ts/schema"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec, GGRpcRequestBuilder, GGRpcRequestParser} from "@grest-ts/http"
import {GGFileDownloadResponseBuilder} from "./GGFileDownloadResponseBuilder";
import {GGFileDownloadResponseParser} from "./GGFileDownloadResponseParser";

export const GGFileDownload = {
    GET: (path: string) => new GGFileDownloadCodec("GET", path),
    POST: (path: string) => new GGFileDownloadCodec("POST", path),
}

class GGFileDownloadCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string
    public readonly responseHeaders = ['Content-Disposition'] as const

    constructor(method: HttpMethod, path: string) {
        this.method = method
        this.path = path
    }

    public createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec {
        this.assertOutputIsNonJson(config.contract);
        this.assertInputIsJson(config.contract);
        return {
            createRequest: new GGRpcRequestBuilder(this.method, this.path, config).createRequest,
            parseResponse: new GGFileDownloadResponseParser(config).parseResponse
        }
    }

    public createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec {
        this.assertOutputIsNonJson(config.contract);
        this.assertInputIsJson(config.contract);
        return {
            parseRequest: new GGRpcRequestParser(this.method, this.path, config).parseRequest,
            sendResponse: new GGFileDownloadResponseBuilder(config).sendResponse
        }
    }

    private assertOutputIsNonJson(contract: GGContractMethod): void {
        const def = contract.success?.toCompilerDef();
        if (!def || !isNonJsonDef(def)) {
            throw new Error(`GGFileDownload.${this.method}("${this.path}") requires output schema to be a non-JSON leaf type (e.g. IsFile). Use GGRpc.GET/POST for routes without file output.`);
        }
    }

    private assertInputIsJson(contract: GGContractMethod): void {
        if (contract.input?.toCompilerDef().hasNonJsonData) {
            throw new Error(`GGFileDownload.${this.method}("${this.path}") does not support non-JSON input data (e.g. files). File download routes accept JSON input only.`);
        }
    }
}
