/**
 * CALL_ON_FACTORY implementation for GGWebSocketSchema.
 *
 * Enables callOn(WebSocketApi) to work by providing WebSocket transport.
 * Returns properly typed GGSocketCall for each clientToServer method,
 * plus connect() for lifecycle and mock for serverToClient events.
 */

import type {GGSocket} from "../../src/socket/GGSocket";
import {GGSocketCall} from "./GGSocketCall";
import {CALL_ON_FACTORY, GG_TEST_RUNNER, GGCallInterceptor, GGCallInterceptorConfig, GGCallOnFactory, GGMockWith, GGTestError, GGTestRunner} from "@grest-ts/testkit";
import {withTimeout} from "@grest-ts/common";
import {GGSocketPool} from "../../src/client/GGSocketPool";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {GGWebSocketSchema} from "../../src/schema/GGWebSocketSchema";
import {GGContractMethod, GGPromise} from "@grest-ts/schema";
import {parseContractResponse} from "@grest-ts/http/testkit";

// ============================================================================
// Type definitions
// ============================================================================

/**
 * Maps clientToServer methods to GGSocketCall.
 * TClientToServer is GGContractClient type (functions), so we extract types from function signatures.
 * Uses Parameters<> to distinguish between functions with and without arguments.
 */
type SocketClientMethods<TClientToServer> = {
    [K in keyof TClientToServer]: TClientToServer[K] extends (...args: any[]) => GGPromise<infer Output, infer Errors>
        ? Parameters<TClientToServer[K]> extends [infer Input]
            ? (data: Input) => GGSocketCall<Input, Output, Errors>
            : Parameters<TClientToServer[K]> extends []
                ? () => GGSocketCall<void, Output, Errors>
                : never
        : never
}

/**
 * Maps serverToClient methods to mock interceptors.
 * TServerToClient is GGContractClient type (functions), so we extract types from function signatures.
 * Uses Parameters<> to distinguish between functions with and without arguments.
 */
type SocketMockMethods<TServerToClient> = {
    [K in keyof TServerToClient]: TServerToClient[K] extends (...args: any[]) => GGPromise<infer Output, any>
        ? Parameters<TServerToClient[K]> extends [infer Input]
            ? GGMockWith<Input, Output, never>
            : Parameters<TServerToClient[K]> extends []
                ? GGMockWith<void, Output, never>
                : never
        : never
}

/**
 * Full WebSocket call map - clientToServer methods + lifecycle + mock.
 * Both type parameters are GGContractClient types (function signatures).
 */
export type GGSocketCallMap<TClientToServer, TServerToClient> =
    SocketClientMethods<TClientToServer> & {
    /** Connect to the WebSocket server. Must be called before sending messages. */
    connect(): Promise<void>
    /** Disconnect from the WebSocket server. */
    disconnect(): Promise<void>
    /** Mock handlers for serverToClient messages. */
    mock: SocketMockMethods<TServerToClient>
}

// ============================================================================
// Module augmentation
// ============================================================================

declare module "../../src/schema/GGWebSocketSchema" {
    interface GGWebSocketSchema<TClientToServer, TServerToClient, TContext, TQuery, TClientToServerImpl> extends GGCallOnFactory {
        [CALL_ON_FACTORY](ctx: GGContext): GGSocketCallMap<TClientToServer, TServerToClient>;
    }
}

// ============================================================================
// Implementation
// ============================================================================

GGWebSocketSchema.prototype[CALL_ON_FACTORY] = function <TClientToServer extends Record<string, GGContractMethod>, TServerToClient extends Record<string, GGContractMethod>>(
    this: GGWebSocketSchema<TClientToServer, TServerToClient, any, any>,
    ctx: GGContext
): GGSocketCallMap<TClientToServer, TServerToClient> {
    const contract = this.contract;
    const name = this.name;
    const middlewares = this.middlewares || [];

    if (!contract) {
        throw new Error(`WebSocketSchema "${name}" has no contract.`);
    }

    const state: { socket: GGSocket | undefined } = {socket: undefined};
    const normalizedPath = this.path.startsWith('/') ? this.path : '/' + this.path;

    // Create mock handlers for serverToClient methods
    const serverToClientMethods = contract.serverToClient.methods;
    const mock: Record<string, any> = {};
    for (const methodName of Object.keys(serverToClientMethods)) {
        const methodContract = serverToClientMethods[methodName];
        Object.defineProperty(mock, methodName, {
            get() {
                if (!state.socket) {
                    throw new Error("Socket is not connected! Call connect() first.");
                }
                return new GGMockWith(GGSocketServerToClientInterceptor, {
                    socket: state.socket,
                    path: `${name}.${methodName}`,
                    contract: methodContract
                });
            },
            enumerable: true
        });
    }

    // Build the API object
    const api: Record<string, any> = {
        connect: async () => {
            state.socket = await new GGContext("SocketConnect").run(async () => {
                GG_TRACE.init();
                const runner = GG_TEST_RUNNER.get();
                const domain = runner.discoveryServer.getRoutingUrl(name);

                // Run socket connection inside ctx so middlewares can read context values
                const socket = await ctx.run(() => withTimeout(GGSocketPool.getOrConnect({
                    domain: domain,
                    path: normalizedPath,
                    middlewares: middlewares
                }), 5000, `Socket connection timeout. Tried to connect to: ${domain}${normalizedPath}`));

                // Set handler for unexpected messages
                socket.setUnknownMessageHandler((messagePath: string, data: any) => {
                    throw new GGTestError({
                        test: "Unexpected socket message received: " + messagePath,
                        expected: "-",
                        received: "Called",
                        extra: "All socket messages must be mocked/expected in tests.\n" +
                            "Did you forget to add .with(api.mock." + messagePath.split('.').pop() + ".toMatchObject(...)) to your test?"
                    });
                });

                return socket;
            });
        },

        disconnect: async () => {
            if (state.socket) {
                await state.socket.close();
                state.socket = undefined;
            }
        },

        mock
    };

    // Add clientToServer methods
    const clientToServerMethods = contract.clientToServer.methods;
    for (const methodName of Object.keys(clientToServerMethods)) {
        const methodContract = clientToServerMethods[methodName] as any;
        api[methodName] = (data?: any) => {
            if (!state.socket) {
                throw new Error("Socket is not connected! Call connect() first.");
            }
            const hasResponse = methodContract.success !== undefined;
            return new GGSocketCall(state.socket, `${name}.${methodName}`, data, hasResponse);
        };
    }

    return api as GGSocketCallMap<TClientToServer, TServerToClient>;
};

// ============================================================================
// ServerToClient Interceptor
// ============================================================================

export interface SocketServerToClientInterceptorConfig extends GGCallInterceptorConfig {
    socket: GGSocket;
    path: string;
    expectError?: any;
    contract?: GGContractMethod;
}

/**
 * Interceptor for serverToClient WebSocket messages.
 *
 * Registers a handler on the socket to intercept incoming server messages.
 * Used for mocking/verifying server-to-client events in tests.
 */
export class GGSocketServerToClientInterceptor extends GGCallInterceptor {

    public readonly socket: GGSocket;
    public readonly path: string;
    protected readonly expectError?: any;
    protected readonly contract?: GGContractMethod;

    constructor(test: GGTestRunner, config: SocketServerToClientInterceptorConfig) {
        if (config.passThrough) {
            throw new Error(
                "Spy mode is not supported for socket interceptors. " +
                "Sockets are meant for browser-to-server communication and spy does not make sense in tests, " +
                "as the browser side is faked."
            );
        }
        super(test, config);
        this.socket = config.socket;
        this.path = config.path;
        this.expectError = config.expectError;
        this.contract = config.contract;
    }

    public getKey(): string {
        return this.path;
    }

    protected doRegister(): void {
        this.socket.registerHandler({
            path: this.path,
            handler: (data: any): GGPromise<any, any> => new GGPromise(this.onRequest(data))
        });
    }

    protected doUnregister(): void {
        this.socket.unregisterHandler(this.path);
    }

    protected parseResponseData(result: any): any {
        return parseContractResponse(result, this.expectError);
    }
}
