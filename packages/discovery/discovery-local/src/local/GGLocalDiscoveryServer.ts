import {GGLog} from "@grest-ts/logger";
import {IPCServer} from "@grest-ts/ipc";
import {RoutingStrategy} from "./routing/RoutingStrategy";
import {FirstStrategy} from "./routing/strategies/FirstStrategy";
import {LastStrategy} from "./routing/strategies/LastStrategy";
import {RandomStrategy} from "./routing/strategies/RandomStrategy";
import {RoundRobinStrategy} from "./routing/strategies/RoundRobinStrategy";
import {GGDiscoveryIPC, DiscoveryServerKind} from "./GGDiscoveryIPC";
import {GGServiceDiscoveryEntry} from "./GGLocalDiscoveryClient";

export const ROUTING_STRATEGIES = {
    first: new FirstStrategy(),
    last: new LastStrategy(),
    random: new RandomStrategy(),
    roundRobin: new RoundRobinStrategy(),
} as const;

export type RoutingStrategyName = "first" | "last" | "roundRobin" | "random" | RoutingStrategy;

/** Server-side bookkeeping: a registered entry remembers which IPC
 *  client registered it, so its routes can be evicted when that client
 *  disconnects without a graceful unregister. The clientId is stamped
 *  by the register handler — never trusted from the wire. Direct
 *  injections via addRoute (e.g. tests) leave it undefined and are
 *  never auto-evicted. */
interface RegisteredEntry extends GGServiceDiscoveryEntry {
    clientId?: string;
}

export class GGLocalDiscoveryServer {

    private readonly server: IPCServer;
    private readonly routes: Map<string, RegisteredEntry[]> = new Map();
    private readonly routingStrategies: Map<string, RoutingStrategy> = new Map();
    public onYield?: () => Promise<void>;
    public readonly kind: DiscoveryServerKind

    constructor(server: IPCServer, kind: DiscoveryServerKind = DiscoveryServerKind.Embedded) {
        this.server = server;
        this.kind = kind;

        // Socket handlers for framework communication
        this.server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.register, async (routes, msg) => {
            for (const route of routes) {
                // Shallow copy + overwrite clientId so a buggy/malicious
                // client cannot smuggle ownership claims through the wire.
                const stored: RegisteredEntry = {...route, clientId: msg.clientId};
                this.addRoute(stored);
            }
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

        this.server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.getServerInfo, async () => ({kind: this.kind}));

        // Defer release so the ack flushes before we close the socket.
        // onYield owners (e.g. resilient client) own teardown themselves.
        this.server.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.requestYield, async () => {
            setTimeout(async () => {
                await this.teardown();
                await this.onYield?.();
            }, 10);
        });

        this.server.setRouteProxyResolver((path) => {
            return this.matchRoute(path)?.baseUrl || "";
        })

        // When an IPC client's socket closes — for any reason, including
        // a SIGKILLed remote process — drop the routes owned by that
        // client. Routes owned by other clients (including legitimate
        // replicas registering identical baseUrls) are untouched.
        this.server.onClientDisconnect((clientId) => {
            this.removeRoutesByClient(clientId);
        });
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
        const stored = route as RegisteredEntry;
        // Dedup on (clientId, api) so a client re-registering its own
        // route — e.g. on reconnect after a leader restart — replaces
        // its previous entry instead of appending a duplicate. Routes
        // from different clients (legitimate replicas) coexist.
        const filtered = stored.clientId !== undefined
            ? existing.filter(r => r.clientId !== stored.clientId)
            : existing;
        filtered.push(stored);
        this.routes.set(route.api, filtered);
        GGLog.info(this, `Added route: ${route.pathPrefix} (${route.api}) -> ${route.baseUrl}`);
    }

    /** Drop every route registered by a given IPC client. Routes added
     *  directly (no clientId) are never matched and stay in place. */
    private removeRoutesByClient(clientId: string): void {
        let removed = 0;
        for (const [api, instances] of this.routes.entries()) {
            const kept = instances.filter(r => r.clientId !== clientId);
            removed += instances.length - kept.length;
            if (kept.length === 0) {
                this.routes.delete(api);
            } else if (kept.length !== instances.length) {
                this.routes.set(api, kept);
            }
        }
        if (removed > 0) {
            GGLog.info(this, `Cleaned up ${removed} routes from disconnected client ${clientId}`);
        }
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
