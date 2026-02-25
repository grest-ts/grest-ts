import type {HttpMethod} from "@grest-ts/common";
import {GGContractMethod} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformClientConfig, GGHttpFetchRequest, GGHttpTransportMiddleware} from "@grest-ts/http";

export class GGFileUploadRequestBuilder {

    public readonly contract: GGContractMethod
    public readonly middlewares: readonly GGHttpTransportMiddleware[]
    public readonly method: HttpMethod;
    public readonly pathTemplate: string;
    public readonly pathParams: string[];
    public readonly pathPrefix: string;

    constructor(
        method: HttpMethod,
        pathTemplate: string,
        config: ClientHttpRouteToRpcTransformClientConfig
    ) {
        this.method = method
        this.pathTemplate = pathTemplate
        this.pathPrefix = config.pathPrefix
        this.contract = config.contract
        this.middlewares = config.middlewares
        this.pathParams = (pathTemplate.match(/:(\w+)/g) || []).map(m => m.slice(1))
    }

    public createRequest = async (data: unknown): Promise<GGHttpFetchRequest> => {
        const formData = await this.buildMultipartBody(data);
        const result: GGHttpFetchRequest = {
            url: this.pathPrefix + this.buildPath(data),
            method: this.method,
            headers: {}, // No Content-Type! fetch() auto-sets it with correct boundary for FormData
            body: formData
        }
        this.middlewares?.forEach(mw => mw.updateRequest?.(result))
        return result
    }

    private buildPath(data: unknown) {
        let path: string = this.pathTemplate;
        if (this.pathParams.length > 0 && typeof data === "object" && data) {
            for (let i = 0; i < this.pathParams.length; i++) {
                const p = this.pathParams[i]
                const val = (data as Record<string, unknown>)[p]
                path = path.replace(':' + p, encodeURIComponent(val === undefined || val === null ? "" : String(val)))
            }
        }
        return path;
    }

    private async buildMultipartBody(data: unknown): Promise<FormData> {
        if (data === undefined || data === null) {
            const formData = new FormData()
            formData.append("__json", "{}")
            return formData
        }
        const inputSchema = this.contract.input!;
        const {json, extras} = await inputSchema.unsafeStringifyMultipart(data);

        const formData = new FormData()
        formData.append("__json", json)
        for (const extra of extras) {
            formData.append(extra.path, extra.blob, extra.filename)
        }
        return formData
    }
}
