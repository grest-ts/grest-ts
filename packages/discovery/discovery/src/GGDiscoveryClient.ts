import {GGLocatorKey} from "@grest-ts/locator";

/**
 * Service token for GGDiscoveryClient.
 * Use this token for registration and lookup of discovery clients.
 */
export const GG_DISCOVERY = new GGLocatorKey<GGDiscoveryClient>("GGDiscovery");

/**
 * What a service registers internally (what GGHttp knows about itself)
 */
export interface GGServiceRegistration {
    runtime: string;
    api: string;
    protocol: "http" | "ws";
    port: number;
    pathPrefix: string;
}

export abstract class GGDiscoveryClient {

    /**
     * Whether this discovery client is for local development mode.
     * When true, cloud resources (AWS SNS, etc.) should use local adapters instead.
     */
    public readonly isLocal: boolean = false;

    /**
     * Register routes that this service provides.
     * Discovery implementation transforms registrations into entries based on environment.
     */
    public abstract registerRoutes(registrations: GGServiceRegistration[]): void;

    /**
     * Register service with service discovery.
     */
    public abstract register(): Promise<void>;

    /**
     * Unregister service from the discovery.
     */
    public abstract unregister(): Promise<void>;

    /**
     * Discover where a specific API is located.
     * Returns the complete URL (baseUrl + pathPrefix) for making requests.
     *
     * The discovery is typically cached by the client to avoid repeated lookups.
     *
     * @param apiName The name of the API to discover (e.g., "UserApi")
     * @returns Complete URL of the API (e.g., "http://someDomain.com/api/users/")
     */
    public abstract discoverApi(apiName: string): Promise<string>;

}
