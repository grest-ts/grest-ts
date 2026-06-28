import {ANY_ERROR, ERROR, GGContractApiDefinition, GGContractClient, GGContractExecutor, GGContractImplementation, GGPromise, OK, SERVER_ERROR} from "@grest-ts/schema"
import {ClientHttpRouteToRpcTransformClientCodec, GGHttpCodec, GGHttpSchema} from "../schema/GGHttpSchema";
import {isBrowser} from "@grest-ts/common";
import type {GGConnectionSettings} from "@grest-ts/context";


declare module "../schema/GGHttpSchema" {
    interface GGHttpSchema<TContract extends GGContractApiDefinition> {
        createClient(config?: GGHttpClientConfig): GGContractClient<TContract>
    }
}

/**
 * HTTP transport function. The signature mirrors `fetch` (URL string + init bag),
 * which lets the default implementation just be `fetch`. Pass a custom transport
 * to plug in pinned-TLS dialing, custom dispatchers, signed-request proxies,
 * or any other wire-layer concern that `fetch` can't accommodate.
 *
 * The `url` arg is `(config.url ?? "") + path-built-from-schema`, so when you
 * pass `url: ""` (or rely on transport-implies-empty), your transport receives
 * just the request path and decides the host itself.
 *
 * The init bag is a fetch-compatible subset: only the fields createClient
 * actually populates. Extending it later is a non-breaking change.
 */
export type GGHttpTransport = (
    url: string,
    init: {
        method: string
        headers: Record<string, string>
        body: string | FormData | undefined
        signal: AbortSignal
        credentials?: "omit" | "same-origin" | "include"
        /** Transport-level dial settings (e.g. TLS pin) contributed by middleware and/or client config. */
        connectionSettings?: GGConnectionSettings
    }
) => Promise<Response>

export interface GGHttpClientConfig {
    url?: string;
    timeout?: number;
    noValidation?: boolean
    /**
     * Cross-origin credentials mode for the default fetch transport. Default
     * (unset → fetch's "same-origin") is unchanged; pass "include" so the browser
     * attaches/stores cross-origin cookies. Ignored by custom transports unless
     * they read it.
     */
    credentials?: "omit" | "same-origin" | "include"
    /**
     * Override the wire-layer call. Defaults to `fetch`. When provided,
     * service discovery is skipped (the transport is presumed to know how
     * to reach the target) and `url` defaults to `""` so the transport sees
     * just the schema-built path.
     */
    transport?: GGHttpTransport
    /**
     * Connection settings (e.g. TLS pin) fixed for this client's lifetime — the direct
     * alternative to a `GGConnectionSettingsKey` middleware. Node-only: setting this on a
     * browser client throws when a request is issued (the browser can't access the TLS layer).
     */
    connectionSettings?: GGConnectionSettings
}

/**
 * Resolves the base URL for URL-less clients from the schema's api name. Attached by the node
 * entry via ./GGHttpSchema.createClient.node, which routes it through @grest-ts/discovery —
 * discovery is node-only, and bundlers follow even a dynamic `import()` at build time
 * regardless of runtime reachability, so the browser bundle must never reference it.
 */
let discoveryUrlResolver: ((apiName: string) => Promise<string>) | undefined

export function _registerDiscoveryUrlResolver(resolver: (apiName: string) => Promise<string>): void {
    discoveryUrlResolver = resolver
}

/**
 * Node-only default transport (pinned-TLS dialing). Attached by the node entry via
 * ./GGHttpSchema.createClient.node; node-only because it imports `node:https`/`node:tls`.
 * When registered it replaces `defaultFetchTransport` as the default (an explicit
 * `config.transport` still wins). It falls back to `fetch` when no TLS pin is set.
 */
let nodeDefaultTransport: GGHttpTransport | undefined

export function _registerNodeDefaultTransport(transport: GGHttpTransport): void {
    nodeDefaultTransport = transport
}

GGHttpSchema.prototype.createClient = function <TContract extends GGContractApiDefinition>(
    this: GGHttpSchema<TContract>,
    config?: GGHttpClientConfig
): GGContractClient<TContract> {
    return createClient(this, config);
}

export function createClient<TContract extends GGContractApiDefinition>(
    httpSchema: GGHttpSchema<TContract>,
    config?: GGHttpClientConfig
): GGContractClient<TContract> {
    config ??= {};
    config.timeout ??= 15000;

    const contract = httpSchema.contract;

    // A custom transport implies "I take over the wire layer" — discovery is
    // off the table (the transport knows how to find the target), and the
    // default base URL becomes "" so the transport sees just the request path.
    const transport: GGHttpTransport = config.transport ?? nodeDefaultTransport ?? defaultFetchTransport;
    if (config.transport && config.url === undefined) {
        config.url = "";
    }

    if (config.url === undefined && isBrowser()) {
        throw new Error("Must define URL for GGHttpClient when running in browser! Use empty string for same-origin requests.");
    }

    const pathPrefix = "/" + httpSchema.pathPrefix + "/";

    const transportImplementation: any = {}
    for (const methodName of Object.keys(httpSchema.codec)) {

        const contractFunction = contract.methods[methodName];
        const noValidation = config?.noValidation === true;

        const codec: GGHttpCodec = httpSchema.codec[methodName];
        const wireFormat: ClientHttpRouteToRpcTransformClientCodec = codec.createForClient({
            pathPrefix: pathPrefix,
            contract: contractFunction,
            middlewares: httpSchema.apiMiddlewares
        })

        const implementation = async (data?: unknown): Promise<OK<unknown> | ANY_ERROR> => {
            try {
                let baseUrl: string | undefined = config.url;
                if (baseUrl === undefined) {
                    try {
                        if (!discoveryUrlResolver) {
                            throw new Error("Service discovery is not available in this environment");
                        }
                        baseUrl = await discoveryUrlResolver(httpSchema.name);
                    } catch (err) {
                        throw new SERVER_ERROR({displayMessage: "Service discovery failed", originalError: err});
                    }
                }

                // ---------------------------------------------
                // Input validation
                const validatedInput = noValidation ? data : GGContractExecutor.parseInput(contractFunction.input, data)

                // ---------------------------------------------
                // Execution
                const fetchRequest = await wireFormat.createRequest(validatedInput);

                const connectionSettings = {...config.connectionSettings, ...fetchRequest.connectionSettings};
                if (isBrowser() && Object.keys(connectionSettings).length > 0) {
                    throw new SERVER_ERROR({displayMessage: "connectionSettings (e.g. TLS pinning) is node-only — the browser can't access the TLS layer, so it can't honor them."});
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.timeout);
                const wireResponse = await transport(baseUrl + fetchRequest.url, {
                    method: fetchRequest.method,
                    signal: controller.signal,
                    headers: fetchRequest.headers,
                    body: fetchRequest.body,
                    credentials: config.credentials,
                    connectionSettings
                }).finally(() => clearTimeout(timeoutId));
                const resData = await wireFormat.parseResponse(wireResponse);

                // ---------------------------------------------
                // Response handling
                const schema = GGContractExecutor.getResponseSchema(contractFunction, resData);
                if (schema) {
                    resData.data = noValidation ? resData.data : GGContractExecutor.parseOutputData(schema, resData.data);
                } else if (resData.data !== undefined) {
                    resData.data = undefined
                }
                if (resData.success === true) {
                    return resData as OK<unknown>;
                } else {
                    return GGContractExecutor.createErrorObj(resData, contractFunction.errors);
                }
                // ---------------------------------------------
            } catch (error) {
                return ERROR.fromUnknown(error);
            }
        };

        transportImplementation[methodName] = (data?: unknown) => {
            return new GGPromise(implementation(data))
        }

    }
    // Per-client stub — doesn't belong in the callOn registry (server's impl does).
    contract.implement(transportImplementation as GGContractImplementation<TContract>, {skipLocatorRegistration: true})
    return transportImplementation;
}

const defaultFetchTransport: GGHttpTransport = (url, init) =>
    fetch(url, init as RequestInit)
