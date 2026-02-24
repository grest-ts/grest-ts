import {GGDiscoveryClient, GGServiceRegistration} from "@grest-ts/discovery";
import {GGLocalDiscoveryServer} from "@grest-ts/discovery-local";

/**
 * Discovery client for test process.
 * Returns the router URL for all API lookups - the router handles actual service routing.
 */
export class GGTestDiscoveryClient extends GGDiscoveryClient {

    public override readonly isLocal = true;

    constructor(private readonly discoveryServer: GGLocalDiscoveryServer) {
        super();
    }

    public registerRoutes(_registrations: GGServiceRegistration[]): void {
        // Test process doesn't register routes - services in workers do that
    }

    public async register(): Promise<void> {
        // No-op for test process
    }

    public async unregister(): Promise<void> {
        // No-op for test process
    }

    public async discoverApi(apiName: string): Promise<string> {
        return this.discoveryServer.getRoutingUrl(apiName);
    }
}
