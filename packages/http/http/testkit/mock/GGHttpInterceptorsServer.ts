import {IPCServer} from "@grest-ts/ipc";
import {GGLog} from "@grest-ts/logger";
import {ERROR} from "@grest-ts/schema";
import {GGTestComponent, GGTestRunner} from "@grest-ts/testkit";
import {GGLocalDiscoveryServer, ROUTING_STRATEGIES} from "@grest-ts/discovery-local";
import type {HttpMethod} from "@grest-ts/common";
import type {GGHttpSchema} from "../../src/schema/GGHttpSchema";
import {GGHttpInterceptor} from "./GGHttpSchema.mock";

interface GGHttpDefaultAnswer {
    apiName: string
    pathPrefix: string
    method: HttpMethod
    path: string
    answer: (body: any) => Promise<unknown>
}

export class GGHttpInterceptorsServer implements GGTestComponent {

    private readonly server: IPCServer
    private readonly discoveryServer: GGLocalDiscoveryServer;
    private readonly interceptors: Map<string, GGHttpInterceptor> = new Map();
    // Track APIs where we've added mock routes (to use "last" routing strategy)
    private readonly mockRoutedApis: Set<string> = new Set();
    private readonly defaults: Map<string, GGHttpDefaultAnswer> = new Map();
    private started = false;

    constructor(runner: GGTestRunner) {
        if (!(runner.discoveryServer instanceof GGLocalDiscoveryServer)) {
            throw new Error("GGHttpInterceptorsServer requires GGLocalDiscoveryServer as discovery server. This should be default for tests...");
        }
        this.server = runner.ipcServer;
        this.discoveryServer = runner.discoveryServer;
    }

    public async start(): Promise<void> {
        this.started = true;
        for (const answer of this.defaults.values()) {
            this.routeToDefault(answer);
            this.interceptWithDefault(answer);
        }
    }

    public async teardown(): Promise<void> {
        this.interceptors.clear();
        this.mockRoutedApis.clear();
        this.defaults.clear();
    }

    /**
     * For framework packages whose own API is called implicitly (e.g. a token endpoint): answers
     * `schema`'s methods while no runtime serves the API. A running service still gets the call, and a
     * test's own mock of the method replaces the answer while it is active.
     */
    public addDefault(schema: GGHttpSchema<any>, answers: Record<string, (body: any) => Promise<unknown>>): void {
        const pathPrefix = "/" + schema.pathPrefix + "/";
        for (const [name, answer] of Object.entries(answers)) {
            const codec = schema.codec[name];
            const entry: GGHttpDefaultAnswer = {apiName: schema.name, pathPrefix, method: codec.method, path: pathPrefix + codec.path, answer};
            this.defaults.set(`${entry.method} ${entry.path}`, entry);
            if (this.started) {
                this.routeToDefault(entry);
                this.interceptWithDefault(entry);
            }
        }
    }

    private routeToDefault(entry: GGHttpDefaultAnswer): void {
        const testServer = this.server.getUrl();
        this.discoveryServer.removeRoute(entry.apiName, testServer);
        this.discoveryServer.addRoute({api: entry.apiName, baseUrl: testServer, pathPrefix: entry.pathPrefix});
        this.discoveryServer.setRoutingStrategy(entry.apiName, {
            select: (instances) => instances.find(i => i.baseUrl !== testServer) ?? instances[0]
        });
    }

    private interceptWithDefault(entry: GGHttpDefaultAnswer): void {
        this.server.interceptHttp(entry.method, entry.path, async (body, _pathParams, headers) => {
            const running = this.runningService(entry.apiName);
            if (running) {
                return await this.forward(running, entry.method, entry.path, body, headers);
            }
            GGLog.debug(this, `[DEFAULT_ANSWER] [${entry.method} ${entry.path}]`, body);
            return {success: true, statusCode: 200, type: "OK", data: await entry.answer(body)};
        });
    }

    private runningService(apiName: string): string | undefined {
        const route = this.discoveryServer.getRoute(apiName);
        return route && route.baseUrl !== this.server.getUrl() ? route.baseUrl : undefined;
    }

    private async forward(baseUrl: string, method: HttpMethod, path: string, body: any, headers?: Record<string, string>): Promise<any> {
        GGLog.debug(this, `Forwarding ${method} ${path} -> ${baseUrl}`);
        // Forward original headers (including auth headers), add/override Content-Type
        const response = await fetch(baseUrl + path, {
            method,
            headers: {...(headers || {}), 'content-type': 'application/json'},
            body: body ? JSON.stringify(body) : undefined
        });
        return await response.json();
    }

    public addInterceptor(interceptor: GGHttpInterceptor) {
        const key = interceptor.getKey();
        const path = interceptor.pathPrefix + interceptor.pathSuffix;
        const mode = interceptor.passThrough ? "spy" : "mock";

        GGLog.debug(this, `Add http ${mode} interceptor [${key}]`);

        if (this.defaults.has(key)) {
            this.server.removeInterceptHttp(interceptor.method, path);
        }

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
            const targetBaseUrl = this.runningService(interceptor.apiName);
            if (!targetBaseUrl) {
                throw new Error(
                    `Cannot add spy for '${interceptor.apiName}' - service is not running!\n` +
                    `Spies require the actual service to be running so requests can be proxied.\n` +
                    `Did you forget to add 'withRuntime(${interceptor.apiName.replace('Api', 'Runtime')})' to your test?`
                );
            }

            this.server.interceptHttp(interceptor.method, path, async (body, _pathParams, headers) => {
                GGLog.debug(this, `[SPIED_REQUEST] [${key}]`, body);
                await interceptor.onRequest(body);

                const responseBody = await this.forward(targetBaseUrl, interceptor.method, path, body, headers);

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

        const defaultAnswer = this.defaults.get(key);
        if (defaultAnswer) {
            this.interceptWithDefault(defaultAnswer);
        }
        // Removing the mock's route also dropped the default's (same baseUrl).
        for (const entry of this.defaults.values()) {
            if (entry.apiName === interceptor.apiName) {
                this.routeToDefault(entry);
                break;
            }
        }
    }
}

GGTestRunner.registerExtension(GGHttpInterceptorsServer);
