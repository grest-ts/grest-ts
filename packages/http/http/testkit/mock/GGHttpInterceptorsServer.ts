import {IPCServer} from "@grest-ts/ipc";
import {GGLog} from "@grest-ts/logger";
import {ERROR} from "@grest-ts/schema";
import {GGTestComponent, GGTestRunner} from "@grest-ts/testkit";
import {GGLocalDiscoveryServer, ROUTING_STRATEGIES} from "@grest-ts/discovery-local";
import {GGHttpInterceptor} from "./GGHttpSchema.mock";

export class GGHttpInterceptorsServer implements GGTestComponent {

    private readonly server: IPCServer
    private readonly discoveryServer: GGLocalDiscoveryServer;
    private readonly interceptors: Map<string, GGHttpInterceptor> = new Map();
    // Track APIs where we've added mock routes (to use "last" routing strategy)
    private readonly mockRoutedApis: Set<string> = new Set();

    constructor(runner: GGTestRunner) {
        if (!(runner.discoveryServer instanceof GGLocalDiscoveryServer)) {
            throw new Error("GGHttpInterceptorsServer requires GGLocalDiscoveryServer as discovery server. This should be default for tests...");
        }
        this.server = runner.ipcServer;
        this.discoveryServer = runner.discoveryServer;
    }

    public async teardown(): Promise<void> {
        this.interceptors.clear();
        this.mockRoutedApis.clear();
    }

    public addInterceptor(interceptor: GGHttpInterceptor) {
        const key = interceptor.getKey();
        const path = interceptor.pathPrefix + interceptor.pathSuffix;
        const mode = interceptor.passThrough ? "spy" : "mock";

        GGLog.debug(this, `Add http ${mode} interceptor [${key}]`);

        if (!interceptor.passThrough) {
            // Mock mode - always add route to discovery server for mocking
            // Use "last" strategy so our mock route (added after service routes) wins
            this.discoveryServer.addRoute({
                api: interceptor.apiName,
                baseUrl: this.server.getUrl(),
                pathPrefix: interceptor.pathPrefix
            });
            this.discoveryServer.setRoutingStrategy(interceptor.apiName, ROUTING_STRATEGIES.last);
            this.mockRoutedApis.add(interceptor.apiName);

            this.server.interceptHttp(interceptor.method, path, async (body) => {
                GGLog.debug(this, `[MOCKED_REQUEST] [${key}]`, body);
                const reply = await interceptor.onRequest(body);
                GGLog.debug(this, `[MOCKED_REPLY] [${key}]`, reply);
                if (reply instanceof ERROR) {
                    return reply.toJSON();
                }
                return {
                    success: true,
                    statusCode: 200,
                    type: "OK",
                    data: reply
                };
            });

        } else {
            // Spy mode - proxy to real service
            const serviceRoute = this.discoveryServer.getRoute(interceptor.apiName);
            if (!serviceRoute) {
                throw new Error(
                    `Cannot add spy for '${interceptor.apiName}' - service is not running!\n` +
                    `Spies require the actual service to be running so requests can be proxied.\n` +
                    `Did you forget to add 'withRuntime(${interceptor.apiName.replace('Api', 'Runtime')})' to your test?`
                );
            }

            const targetBaseUrl = serviceRoute.baseUrl;

            this.server.interceptHttp(interceptor.method, path, async (body, _pathParams, headers) => {
                GGLog.debug(this, `[SPIED_REQUEST] [${key}]`, body);
                await interceptor.onRequest(body);

                GGLog.debug(this, `Forwarding ${interceptor.method} ${path} -> ${targetBaseUrl}`);

                // Forward original headers (including auth headers), add/override Content-Type
                const forwardHeaders: Record<string, string> = {
                    ...(headers || {}),
                    'content-type': 'application/json'
                };

                const response = await fetch(targetBaseUrl + path, {
                    method: interceptor.method,
                    headers: forwardHeaders,
                    body: body ? JSON.stringify(body) : undefined
                });
                const responseBody = await response.json();

                await interceptor.onResponse(responseBody);
                GGLog.debug(this, `[SPIED_RESPONSE] [${key}]`, responseBody);
                return responseBody;
            });
        }

        this.interceptors.set(key, interceptor);
    }

    public deleteInterceptor(interceptor: GGHttpInterceptor) {
        const key = interceptor.getKey();
        const path = interceptor.pathPrefix + interceptor.pathSuffix;
        const mode = interceptor.passThrough ? "spy" : "mock";

        this.interceptors.delete(key);
        GGLog.debug(this, `Remove http ${mode} interceptor [${key}]`);

        this.server.removeInterceptHttp(interceptor.method, path);

        // For mock mode, remove only our mock route entry (by baseUrl), not the real service routes
        if (!interceptor.passThrough) {
            this.discoveryServer.removeRoute(interceptor.apiName, this.server.getUrl());
            this.mockRoutedApis.delete(interceptor.apiName);
            // Restore default routing strategy if no more mock routes for this API
            this.discoveryServer.setRoutingStrategy(interceptor.apiName, ROUTING_STRATEGIES.roundRobin);
        }
    }
}

GGTestRunner.registerExtension(GGHttpInterceptorsServer);
