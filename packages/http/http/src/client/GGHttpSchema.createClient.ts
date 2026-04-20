import {ANY_ERROR, ERROR, GGContractApiDefinition, GGContractClient, GGContractExecutor, GGContractImplementation, GGPromise, OK, SERVER_ERROR} from "@grest-ts/schema"
import {ClientHttpRouteToRpcTransformClientCodec, GGHttpCodec, GGHttpSchema} from "../schema/GGHttpSchema";
import {isBrowser} from "@grest-ts/common";


declare module "../schema/GGHttpSchema" {
    interface GGHttpSchema<TContract extends GGContractApiDefinition, TContext = {}> {
        createClient(config?: GGHttpClientConfig): GGContractClient<TContract>
    }
}

export interface GGHttpClientConfig {
    url?: string;
    timeout?: number;
    noValidation?: boolean
}

GGHttpSchema.prototype.createClient = function <TContract extends GGContractApiDefinition, TContext>(
    this: GGHttpSchema<TContract, TContext>,
    config?: GGHttpClientConfig
): GGContractClient<TContract> {
    return createClient(this, config);
}

export function createClient<TContract extends GGContractApiDefinition, TContext>(
    httpSchema: GGHttpSchema<TContract, TContext>,
    config?: GGHttpClientConfig
): GGContractClient<TContract> {
    config ??= {};
    config.timeout ??= 15000;

    if (config.url === undefined && isBrowser()) {
        throw new Error("Must define URL for GGHttpClient when running in browser! Use empty string for same-origin requests.");
    }

    const pathPrefix = "/" + httpSchema.pathPrefix + "/";

    const transportImplementation: any = {}
    for (const methodName of Object.keys(httpSchema.codec)) {

        const contractFunction = httpSchema.contract.methods[methodName];
        const noValidation = config?.noValidation === true;

        const codec: GGHttpCodec = httpSchema.codec[methodName];
        const wireFormat: ClientHttpRouteToRpcTransformClientCodec = codec.createForClient({
            pathPrefix: pathPrefix,
            contract: contractFunction,
            middlewares: httpSchema.apiMiddlewares
        })

        const implementation = async (data?: unknown): Promise<OK<unknown> | ANY_ERROR> => {
            try {
                let baseUrl: string = config.url;
                if (baseUrl === undefined) {
                    try {
                        const {GG_DISCOVERY} = await import(/* @vite-ignore */ '@grest-ts/discovery');
                        baseUrl = await GG_DISCOVERY.get().discoverApi(httpSchema.name);
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
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.timeout);
                const wireResponse = await fetch(baseUrl + fetchRequest.url, {
                    method: fetchRequest.method,
                    signal: controller.signal,
                    headers: fetchRequest.headers,
                    body: fetchRequest.body
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
    httpSchema.contract.implement(transportImplementation as GGContractImplementation<TContract>, {skipLocatorRegistration: true})
    return transportImplementation;
}