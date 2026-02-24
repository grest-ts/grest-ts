import type http from "http";
import type {HttpMethod} from "@grest-ts/common";
import {GGContractExecutor, GGContractMethod} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformServerConfig, GGHttpRequest, GGHttpTransportMiddleware} from "../../schema/GGHttpSchema";
import type {GGHttpServerMiddleware} from "../../server/GGHttpSchema.startServer";

export class GGRpcRequestParser {

    private readonly pathTemplate: string;
    private readonly pathParams: string[];
    private readonly hasBody: boolean;
    protected readonly contract: GGContractMethod
    private readonly apiMiddlewares: readonly GGHttpTransportMiddleware[]
    private readonly serverMiddlewares: readonly GGHttpServerMiddleware[]

    constructor(
        method: HttpMethod,
        pathTemplate: string,
        config: ClientHttpRouteToRpcTransformServerConfig
    ) {
        this.pathTemplate = pathTemplate
        this.pathParams = (pathTemplate.match(/:(\w+)/g) || []).map(m => m.slice(1))
        this.hasBody = method === "POST" || method === "PUT" || method === "PATCH"
        this.contract = config.contract
        this.apiMiddlewares = config.apiMiddlewares
        this.serverMiddlewares = config.serverMiddlewares
    }

    public parseRequest = async (req: http.IncomingMessage): Promise<unknown> => {
        const url = req.url || '/'
        const qIndex = url.indexOf('?')
        const queryArgs = this.parseQueryString(qIndex === -1 ? '' : url.substring(qIndex + 1))
        if (this.apiMiddlewares?.length > 0) {
            const mwQuery: GGHttpRequest = {headers: req.headers, queryArgs: queryArgs}
            this.apiMiddlewares?.forEach(mw => mw.parseRequest?.(mwQuery))
        }
        for (const mw of this.serverMiddlewares ?? []) await mw.process?.();

        let input: unknown;
        if (this.hasBody) {
            input = await this.parseBody(req);
        } else if (this.pathParams.length > 0) {
            input = {
                ...this.extractPathParams(qIndex === -1 ? url : url.substring(0, qIndex)),
                ...queryArgs
            };
        } else {
            input = queryArgs;
        }
        return GGContractExecutor.parseInput(this.contract.input, input);
    }

    private parseQueryString(rawQuery: string): Record<string, string | string[]> {
        const result: Record<string, string | string[]> = {}
        if (rawQuery) {
            const params = new URLSearchParams(rawQuery)
            for (const [key, value] of params.entries()) {
                result[key] = value
            }
        }
        return result;
    }

    private extractPathParams(actualPath: string): Record<string, string> {
        const result: Record<string, string> = {}
        const templateParts = this.pathTemplate.split('/').filter(p => p)
        const actualParts = actualPath.split('/').filter(p => p)
        const offset = actualParts.length - templateParts.length
        if (offset >= 0) {
            for (let i = 0; i < templateParts.length; i++) {
                const templatePart = templateParts[i]
                if (templatePart.startsWith(':')) {
                    const paramName = templatePart.slice(1)
                    result[paramName] = decodeURIComponent(actualParts[offset + i] || '')
                }
            }
        }
        return result;
    }

    private async parseBody(req: http.IncomingMessage): Promise<unknown> {
        const contentType = req.headers['content-type'] || ''
        const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data')
        if (isMultipart) {
            throw new Error("Received multipart request on a JSON-only route. Use GGRpc.MULTIPART_POST for routes with file uploads.")
        } else {
            const rawBody: Buffer = await new Promise((resolve, reject) => {
                const chunks: Buffer[] = []
                req.on('data', (chunk: Buffer) => chunks.push(chunk))
                req.on('end', () => resolve(Buffer.concat(chunks)))
                req.on('error', reject)
            });
            if (rawBody && rawBody.length > 0) {
                return JSON.parse(rawBody.toString('utf-8'))
            } else {
                return undefined
            }
        }
    }
}
