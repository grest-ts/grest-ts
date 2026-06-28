import type {HttpMethod} from "@grest-ts/common";
import {GGContractMethod} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformClientConfig, GGHttpFetchRequest} from "../../schema/GGHttpSchema";
import {GGContextKey, type GGConnectionSettings, type GGTransportMiddleware} from "@grest-ts/context";
import {GGContextKeySynchronizer} from "../../client/GGContextKeySynchronizer";

export class GGRpcRequestBuilder {

    public readonly contract: GGContractMethod
    public readonly middlewares: readonly GGTransportMiddleware[]
    public readonly method: HttpMethod;
    public readonly pathTemplate: string;
    public readonly pathParams: string[];
    public readonly pathPrefix: string;
    public readonly hasBody: boolean;

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
        this.hasBody = method === "POST" || method === "PUT" || method === "PATCH"
    }

    public createRequest = async (data: unknown): Promise<GGHttpFetchRequest> => {
        let result: GGHttpFetchRequest;
        if (this.hasBody) {
            result = {
                url: this.pathPrefix + this.buildPath(data),
                method: this.method,
                headers: {'Content-Type': 'application/json'},
                body: this.buildBody(data)
            }
        } else {
            result = {
                url: this.pathPrefix + this.buildPath(data) + this.buildQueryString(data as Record<string, unknown>),
                method: this.method,
                headers: {},
                body: undefined
            }
        }
        for (const mw of this.middlewares ?? []) {
            if (mw instanceof GGContextKey) {
                await GGContextKeySynchronizer.waitFor(mw)
            }
        }
        this.middlewares?.forEach(mw => mw.update?.(result))
        const settings: GGConnectionSettings = {}
        this.middlewares?.forEach(mw => mw.connectionSettings?.(settings))
        result.connectionSettings = settings
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

    private buildBody(data: unknown) {
        if (data === undefined || data === null) {
            return undefined;
        }
        if (this.contract.input?.def.hasNonJsonData) {
            throw new Error("Schema contains non-JSON data (e.g. files). Use GGRpc.MULTIPART_POST instead of GGRpc.POST for this route.")
        } else {
            return JSON.stringify(data)
        }
    }

    private buildQueryString(data: unknown): string {
        if (data && typeof data === "object") {
            const params = new URLSearchParams()
            for (const [key, value] of Object.entries(data)) {
                if (value !== undefined && value !== null) {
                    if (this.pathParams.length > 0 && this.pathParams.includes(key)) {
                        continue;
                    }
                    params.append(key, String(value))
                }
            }
            const query = params.toString()
            if (query) {
                return "?" + query
            }
        }
        return ""
    }
}
