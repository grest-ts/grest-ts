import {GG_DISCOVERY, GGDiscoveryClient, GGServiceRegistration} from "@grest-ts/discovery";
import {GGLog} from "@grest-ts/logger";
import {IPCClient} from "@grest-ts/ipc";
import {GGLocator, GGLocatorServiceType} from "@grest-ts/locator";
import {GGDiscoveryIPC} from "./GGDiscoveryIPC";
import {SERVER_ERROR} from "@grest-ts/schema";

/**
 * ENV variable key when running in tests, for example - this would be PORT of the service discovery instance.
 * If running in tests, the test itself also acts as a service discovery of sorts, allowing multiple instances to run in parallel.
 */
export const GG_LOCAL_ROUTER_PORT = "GG_LOCAL_ROUTER_PORT"

/** Default port for the local discovery router. Centralised so a future
 *  change (env-var override, per-environment isolation) has one hook. */
export function getLocalDiscoveryPort(): number {
    const v = process.env[GG_LOCAL_ROUTER_PORT];
    if (v === undefined) return 9000;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid ${GG_LOCAL_ROUTER_PORT}=${v}, expected positive integer`);
    }
    return n;
}

export class GGLocalDiscoveryClient extends GGDiscoveryClient {

    public override readonly isLocal = true;
    public readonly port;
    protected readonly entries: GGServiceDiscoveryEntry[] = [];
    protected readonly client: IPCClient;

    constructor(port?: number) {
        if (port === undefined) {
            throw new Error("No port specified for local router");
        }
        super();
        this.port = port;
        this.client = new IPCClient(port);
        GGLog.info(this, "Started on port: " + this.port);

        GGLocator.getScope().setWithLifecycle(GG_DISCOVERY, this, {
            type: GGLocatorServiceType.SERVICE_DISCOVERY,
            start: () => this.register(),
            teardown: () => this.unregister()
        })
    }

    public registerRoutes(registrations: GGServiceRegistration[]): void {
        for (const reg of registrations) {
            this.entries.push({
                api: reg.api,
                baseUrl: `${reg.protocol}://localhost:${reg.port}`,
                pathPrefix: reg.pathPrefix
            });
        }
    }

    public async discoverApi(apiName: string): Promise<string> {
        await this.ensureConnected();
        const res = await this.client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.discoverApi, apiName);
        if (res.success && res.url) {
            return res.url;
        } else {
            throw new SERVER_ERROR({
                displayMessage: res.error ?? "Unknown error",
                debugData: {apiName}
            })
        }
    }

    public async register(): Promise<void> {
        await this.ensureConnected();
        if (this.entries.length > 0) {
            await this.client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.register, this.entries);
        }
        GGLog.info(this, `Registered ${this.entries.length} routes`);
    }

    public async unregister(): Promise<void> {
        if (this.entries.length > 0 && this.client.isConnected()) {
            try {
                await this.client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.unregister, this.entries);
            } catch (err: any) {
                GGLog.error(this, err);
            }
        }
        this.client.disconnect();
    }

    protected async ensureConnected(): Promise<void> {
        if (this.client.isConnected()) return;
        // Retry with backoff: when the router runs as its own process
        // (e.g. launched via the `discovery-local` bin), a runtime can
        // come up before the router has bound its port. Tolerate that
        // instead of failing the runtime's startup outright.
        const maxRetries = 20;
        for (let attempt = 0; ; attempt++) {
            try {
                await this.client.connect();
                return;
            } catch (err: any) {
                if (attempt >= maxRetries || !isConnectionError(err)) throw err;
                GGLog.debug(this, "Waiting for discovery router...");
                await new Promise(r => setTimeout(r, Math.min(500 * Math.pow(1.5, attempt), 5000)));
            }
        }
    }
}

/** True for the transient socket errors seen while a router process is
 *  still coming up — worth retrying, unlike a real protocol failure. */
function isConnectionError(err: any): boolean {
    const codes = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENOENT"];
    const has = (code?: string) => code !== undefined && codes.includes(code);
    return has(err?.code) || has(err?.cause?.code)
        || has(err?.originalError?.code) || has(err?.originalError?.cause?.code);
}

/**
 * What consumers need to discover and connect to a service
 */
export interface GGServiceDiscoveryEntry {
    api: string;
    baseUrl: string;     // Complete base URL: "http://localhost:8080" or "http://service-name:8080"
    pathPrefix: string;  // Path to append: "/api/users/"
}

