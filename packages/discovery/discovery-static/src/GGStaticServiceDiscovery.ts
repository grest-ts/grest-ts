import {GGDiscoveryClient, GGServiceRegistration} from "@grest-ts/discovery";
import {GGLog} from "@grest-ts/logger";

/**
 * Static service discovery for simple cloud deployments
 *
 * Use this when:
 * - Running on AWS Elastic Beanstalk, Heroku, Railway, Fly.io, etc.
 * - You have static/known service URLs
 * - No dynamic service discovery infrastructure (no Consul, K8s, etc.)
 * - Services are configured via environment variables
 *
 * Example environment variables:
 * ```
 * USER_API_URL=https://user-service.elasticbeanstalk.com/api/users/
 * ORDER_API_URL=https://order-service.us-east-1.elasticbeanstalk.com/api/orders/
 * PAYMENT_API_URL=https://payment.myapp.com/api/payments/
 * ```
 *
 * Or using a config object:
 * ```typescript
 * const discovery = new GGStaticServiceDiscovery({
 *   UserApi: 'https://user-service.elasticbeanstalk.com/api/users/',
 *   OrderApi: 'https://order-service.elasticbeanstalk.com/api/orders/'
 * });
 * ```
 */
export class GGStaticServiceDiscovery extends GGDiscoveryClient {

    private readonly apiUrls: Map<string, string> = new Map();

    /**
     * @param config Optional static configuration map (apiName -> full URL)
     *               If not provided, will read from environment variables: {API_NAME}_URL
     */
    constructor(config?: Record<string, string>) {
        super();

        if (config) {
            // Use provided config
            for (const [apiName, url] of Object.entries(config)) {
                this.apiUrls.set(apiName, url);
                GGLog.info(this, `Configured ${apiName}: ${url}`);
            }
        } else {
            // Auto-discover from environment variables
            // Looks for env vars like: USER_API_URL, ORDER_API_URL, etc.
            GGLog.info(this, 'Reading API URLs from environment variables...');

            for (const [key, value] of Object.entries(process.env)) {
                if (key.endsWith('_API_URL') && value) {
                    // Convert USER_API_URL -> UserApi
                    const apiName = this.envVarToApiName(key);
                    this.apiUrls.set(apiName, value);
                    GGLog.info(this, `Configured ${apiName}: ${value} (from ${key})`);
                }
            }

            if (this.apiUrls.size === 0) {
                GGLog.warn(this, 'No API URLs found in environment variables. Expected format: {API_NAME}_URL');
            }
        }
    }

    /**
     * Convert environment variable name to API name
     * USER_API_URL -> UserApi
     * ORDER_SERVICE_API_URL -> OrderServiceApi
     */
    private envVarToApiName(envVar: string): string {
        // Remove _API_URL suffix
        const withoutSuffix = envVar.replace(/_API_URL$/, '');

        // Split by underscore and capitalize each part
        const parts = withoutSuffix.split('_');
        const capitalized = parts.map(part =>
            part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        );

        return capitalized.join('') + 'Api';
    }

    public registerRoutes(registrations: GGServiceRegistration[]): void {
        // In static discovery, we don't register anything
        // The URLs are pre-configured via environment variables or constructor
        GGLog.debug(this, `Skipping route registration (static discovery) for ${registrations.length} route(s)`);
    }

    public async register(): Promise<void> {
        // No registration needed for static discovery
        GGLog.info(this, `Static service discovery initialized with ${this.apiUrls.size} API(s)`);
    }

    public async unregister(): Promise<void> {
        // Nothing to unregister
        GGLog.debug(this, 'Static service discovery unregister (no-op)');
    }

    public async discoverApi(apiName: string): Promise<string> {
        const fullUrl = this.apiUrls.get(apiName);

        if (!fullUrl) {
            const availableApis = Array.from(this.apiUrls.keys()).join(', ');
            throw new Error(
                `API '${apiName}' not configured in static service discovery.\n` +
                `Available APIs: ${availableApis}\n` +
                `\n` +
                `To configure this API, either:\n` +
                `1. Set environment variable: ${this.apiNameToEnvVar(apiName)}=${this.getExampleUrl(apiName)}\n` +
                `2. Pass config to constructor: new GGStaticServiceDiscovery({ ${apiName}: '${this.getExampleUrl(apiName)}' })`
            );
        }

        return fullUrl;
    }

    /**
     * Convert API name to environment variable name
     * UserApi -> USER_API_URL
     */
    private apiNameToEnvVar(apiName: string): string {
        // Remove 'Api' suffix if present
        const withoutApi = apiName.endsWith('Api') ? apiName.slice(0, -3) : apiName;

        // Convert camelCase to SCREAMING_SNAKE_CASE
        const snakeCase = withoutApi.replace(/([A-Z])/g, '_$1').toUpperCase();

        return snakeCase.replace(/^_/, '') + '_API_URL';
    }

    private getExampleUrl(apiName: string): string {
        const serviceName = apiName.replace(/Api$/, '').toLowerCase();
        return `https://${serviceName}.elasticbeanstalk.com/api/${serviceName}/`;
    }
}
