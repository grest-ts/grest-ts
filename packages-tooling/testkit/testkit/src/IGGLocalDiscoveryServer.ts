/**
 * Interface for discovery server used by GGTestRunner.
 * Implemented by GGLocalDiscoveryServer in @grest-ts/discovery.
 * This interface allows @grest-ts/testkit to not depend on @grest-ts/discovery.
 */
export interface IGGLocalDiscoveryServer {
    start(): Promise<boolean>;
    teardown(): Promise<void>;
    getRoutingUrl(api: string): string;
}

export interface IServiceRoute {
    api: string;
    baseUrl: string;
    pathPrefix: string;
}
