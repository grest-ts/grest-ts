import {GGLog} from "@grest-ts/logger";
import {IPCServer} from "@grest-ts/ipc";
import {RoutingStrategy} from "./routing/RoutingStrategy";
import {FirstStrategy} from "./routing/strategies/FirstStrategy";
import {LastStrategy} from "./routing/strategies/LastStrategy";
import {RandomStrategy} from "./routing/strategies/RandomStrategy";
import {RoundRobinStrategy} from "./routing/strategies/RoundRobinStrategy";
import {GGDiscoveryIPC} from "./GGDiscoveryIPC";
import {GGServiceDiscoveryEntry} from "./GGLocalDiscoveryClient";

export const ROUTING_STRATEGIES = {
    first: new FirstStrategy(),
    last: new LastStrategy(),
    random: new RandomStrategy(),
    roundRobin: new RoundRobinStrategy(),
} as const;

export type RoutingStrategyName = "first" | "last" | "roundRobin" | "random" | RoutingStrategy;

export class GGLocalDiscoveryServer {

    private readonly server: IPCServer;
    private readonly routes: Map<string, GGServiceDiscoveryEntry[]> = new Map();
    private readonly routingStrategies: Map<string, RoutingStrategy> = new Map();

    constructor(server: IPCServer) {
        this.server = server;

        // Socket handlers for framework communication
        this.server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.register, async (routes) => {
            routes.forEach(route => this.addRoute(route));
        });

        this.server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.unregister, async (routes) => {
            routes.forEach(route => this.removeRoute(route.api));
        });

        this.server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.discoverApi, async (apiName) => {
            if (this.getRoute(apiName)) {
                return {success: true, url: this.server.getUrl()};
            }
            return {success: false, error: "Service '" + apiName + "' is not registered! Did you forget to start it?"};
        });

        this.server.setRouteProxyResolver((path) => {
            return this.matchRoute(path)?.baseUrl || undefined;
        })
    }

    public async start(): Promise<boolean> {
        const result = await this.server.start();
        if (result) {
            GGLog.info(this, `Router started on ${this.server.getUrl()}`);
        }
        return result;
    }

    public async teardown(): Promise<void> {
        this.routes.clear();
        this.routingStrategies.clear();
        await this.server.teardown();
        GGLog.info(this, 'Router stopped');
    }

    public setRoutingStrategy(api: string, strategy: RoutingStrategyName | RoutingStrategy): void {
        const strategyInstance = typeof strategy === 'string' ? ROUTING_STRATEGIES[strategy] : strategy;
        this.routingStrategies.set(api, strategyInstance);
        GGLog.debug(this, `Set routing strategy for ${api}: ${strategyInstance.constructor.name}`);
    }

    private getRoutingStrategy(api: string): RoutingStrategy {
        return this.routingStrategies.get(api) ?? ROUTING_STRATEGIES.roundRobin;
    }

    public getRoute(api: string): GGServiceDiscoveryEntry | undefined {
        const instances = this.routes.get(api);
        if (!instances || instances.length === 0) {
            return undefined;
        }
        const strategy = this.getRoutingStrategy(api);
        return strategy.select(instances, api);
    }

    public addRoute(route: GGServiceDiscoveryEntry): void {
        const existing = this.routes.get(route.api) ?? [];
        existing.push(route);
        this.routes.set(route.api, existing);
        GGLog.info(this, `Added route: ${route.pathPrefix} (${route.api}) -> ${route.baseUrl}`);
    }

    public removeRoute(api: string, baseUrl?: string): void {
        const instances = this.routes.get(api);
        if (!instances) return;

        if (baseUrl) {
            // Remove specific instance
            const filtered = instances.filter(r => r.baseUrl !== baseUrl);
            if (filtered.length === 0) {
                this.routes.delete(api);
            } else {
                this.routes.set(api, filtered);
            }
            GGLog.info(this, `Removed route instance: ${api} -> ${baseUrl}`);
        } else {
            // Remove all instances for this API
            const route = instances[0];
            this.routes.delete(api);
            GGLog.info(this, `Removed route: ${route?.pathPrefix} (${api})`);
        }
    }

    public getRoutingUrl(api: string): string {
        if (!this.getRoute(api)) {
            throw new Error(`API '${api}' not registered in router`);
        }
        if (!this.server.getUrl()) {
            throw new Error("Router not started yet!");
        }
        return this.server.getUrl();
    }

    private matchRoute(path: string): GGServiceDiscoveryEntry | undefined {
        let bestApi: string | undefined;
        let longestMatch = 0;

        // Find the best matching API based on path prefix
        for (const [api, instances] of this.routes.entries()) {
            if (instances.length === 0) continue;
            const pathPrefix = instances[0].pathPrefix;
            if (path.startsWith(pathPrefix) && pathPrefix.length > longestMatch) {
                bestApi = api;
                longestMatch = pathPrefix.length;
            }
        }

        if (!bestApi) return undefined;

        // Use routing strategy to select which instance, passing the full path
        const instances = this.routes.get(bestApi)!;
        const strategy = this.getRoutingStrategy(bestApi);
        return strategy.select(instances, path);
    }
}
