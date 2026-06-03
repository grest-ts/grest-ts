/**
 * Server extension for HttpApiSchema - adds register method.
 * This file should only be imported in server (Node.js) context.
 */

import http from "http";
import {GGLocator} from "@grest-ts/locator";
import {ClientHttpRouteToRpcTransformServerCodec, GGHttpCodec, GGHttpSchema} from "../schema/GGHttpSchema";
import {ERROR, GGContractApiDefinition, GGContractImplementation, GGContractMethod, OK, SERVER_ERROR} from "@grest-ts/schema";
import {HttpMethod} from "@grest-ts/common";
import {GG_DISCOVERY} from "@grest-ts/discovery";
import {GGContext, GGContextStore, type GGTransportMiddleware} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {GG_HTTP_REQUEST} from "./GG_HTTP_REQUEST";
import {GG_COOKIE_WRITES} from "../schema/GGCookie";
import {GG_METRICS} from "@grest-ts/metrics";
import {GGHttpMetrics} from "./GGHttpMetrics";
import {GG_HTTP_SERVER} from "./GG_HTTP_SERVER";
import {GGHttpServer} from "./GGHttpServer";
import {GGLog} from "@grest-ts/logger";
import {GGHttpPermissionsChecker} from "../schema/GGHttpPermissionsChecker";

export interface GGHttpSchemaConfig {
    /**
     * The HTTP request handler to register with.
     */
    http?: GGHttpServer;
    /**
     * Additional middlewares to apply to all routes.
     */
    middlewares?: GGTransportMiddleware[];
}

declare module "../schema/GGHttpSchema" {
    interface GGHttpSchema<TContract extends GGContractApiDefinition> {
        /**
         * Start server with direct implementation.
         * Uses parseRequest from use classes without transform.
         * For custom transforms, use createServer() instead.
         */
        register(implementation: GGContractImplementation<TContract>, config?: GGHttpSchemaConfig): void
    }
}

GGHttpSchema.prototype.register = function <TContract extends GGContractApiDefinition>(
    this: GGHttpSchema<TContract>,
    implementation: GGContractImplementation<TContract>,
    config?: GGHttpSchemaConfig
) {
    return setupRoutes(this, implementation, config)
}

function setupRoutes<TContract extends GGContractApiDefinition>(
    httpSchema: GGHttpSchema<TContract>,
    implementation: GGContractImplementation<TContract>,
    config?: GGHttpSchemaConfig
) {
    config ??= {};
    config.middlewares ??= [];

    if (!httpSchema.contract) throw new Error(`HttpApiSchema "${httpSchema.name}" has no contract.`);

    const server = config.http ?? GGLocator.getScope().get(GG_HTTP_SERVER);
    if (!server) throw new Error(`No HTTP server found. Make sure to register GGHttpServerAdapter in the scope or pass handler via config`)

    server._registerSchema(httpSchema as GGHttpSchema<any, any>);

    const pathPrefix = "/" + httpSchema.pathPrefix + "/"
    const apiMiddlewares = httpSchema.apiMiddlewares;
    const scope = GGLocator.getScope();
    const parentContext = GGContextStore.tryGetContext();

    const permissionsChecker = new GGHttpPermissionsChecker(apiMiddlewares);
    for (const mw of apiMiddlewares) {
        const hKeys = Object.keys(mw.headers ?? {});
        const rhKeys = Object.keys(mw.responseHeaders ?? {});
        if (hKeys.length) server.registerCorsHeaders(hKeys);
        if (rhKeys.length) server.registerCorsExposeHeaders(rhKeys);
    }
    for (const methodName in httpSchema.codec) {
        const codec: GGHttpCodec = httpSchema.codec[methodName];
        const rhKeys = Object.keys(codec?.responseHeaders ?? {});
        if (rhKeys.length) server.registerCorsExposeHeaders(rhKeys);
    }

    server.onStart(() => {
        const port = server.port;
        if (port === undefined) throw new Error("HTTP server port is not set; onStart ran before listen completed.");
        GG_DISCOVERY.tryGet()?.registerRoutes([{
            runtime: scope.serviceName,
            api: httpSchema.name,
            pathPrefix: pathPrefix,
            protocol: "http",
            port: port
        }]);
    })

    // Info: Contract instance is auto-registered in GGLocator via patched implement()
    // @TODO This is not really used and only for testkit so it would register implementation of the contract... Not cool
    httpSchema.contract.implement(implementation);

    for (const methodName in httpSchema.codec) {
        // Wire format.
        const codec: GGHttpCodec = httpSchema.codec[methodName]
        if (!codec) throw new Error(`Contract for "${httpSchema.name}.${methodName}" is missing wire format!`)

        // Implementation function
        const implMethod = implementation[methodName] as ((data?: unknown) => Promise<unknown>) | undefined
        const implFn = implMethod?.bind(implementation)
        if (!implFn) throw new Error(`Implementation for "${httpSchema.name}.${methodName}" is missing implementation method!`)

        // Input schema
        const contractFunctionSchema: GGContractMethod = httpSchema.contract.methods[methodName as keyof TContract]
        if (!contractFunctionSchema) throw new Error(`Contract for "${httpSchema.name}.${methodName}" is missing contract function schema!`)

        // build request mapping
        const requestParser: ClientHttpRouteToRpcTransformServerCodec = codec.createForServer({
            contract: contractFunctionSchema,
            middlewares: [...apiMiddlewares, ...(config.middlewares ?? [])]
        })
        const cookieWriteNames = new Set((codec.updatesCookies ?? []).map(k => k.name))
        server.registerRoute(codec.method, pathPrefix + codec.path, async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
            scope.ensureEntered();
            return new GGContext("REQ", parentContext, true).run(async () => {
                GG_TRACE.init();
                GG_HTTP_REQUEST.set({port: server.port ?? 0, method: req.method ?? "", path: req.url ?? ""});
                GG_COOKIE_WRITES.set(cookieWriteNames);
                const startTime = performance.now()
                let rpcResult: ERROR<string, unknown> | OK<unknown> | undefined
                try {
                    const rawInput = await requestParser.readRequest(req)
                    await permissionsChecker.assert(httpSchema.name, methodName, contractFunctionSchema.permission)
                    try {
                        rpcResult = {success: true, type: "OK", data: await implFn(requestParser.validateInput(rawInput))}
                        // GGLog.debug(httpSchema, "Response", rpcResult) // This is very slow to log this (like 3x performance loss)
                    } catch (error: unknown) {
                        rpcResult = ERROR.fromUnknown(error);
                        if (rpcResult instanceof SERVER_ERROR || (rpcResult as ERROR<string, unknown>).hasDebugContext()) {
                            GGLog.error(httpSchema, rpcResult)
                        }
                    }
                    await requestParser.sendResponse(res, rpcResult) // can throw
                } catch (error: unknown) {
                    rpcResult = ERROR.fromUnknown(error)
                    await requestParser.sendResponse(res, rpcResult) // Does not throw
                    GGLog.error(httpSchema, rpcResult)
                } finally {
                    metrics(rpcResult?.type, httpSchema.name, codec.method, pathPrefix, codec.path, startTime)
                }
            });
        }, `${httpSchema.name}.${methodName}`)
    }
}

function metrics(
    resultType: string | undefined,
    apiName: string,
    method: HttpMethod,
    pathPrefix: string,
    pathSuffix: string,
    startTime: number
) {
    if (GG_METRICS.has()) {
        const path = method + " " + pathPrefix + pathSuffix;
        GGHttpMetrics.requests.inc(1, {
            api: apiName,
            method: pathSuffix,
            path: path,
            result: resultType ?? "unknown"
        });
        GGHttpMetrics.requestDuration.observe(performance.now() - startTime, {
            api: apiName,
            method: pathSuffix,
            path: path
        });
    }
}
