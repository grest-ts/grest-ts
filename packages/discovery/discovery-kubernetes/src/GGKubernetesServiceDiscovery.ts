import {GGDiscoveryClient, GGServiceRegistration} from "@grest-ts/discovery";
import {GGLog} from "@grest-ts/logger";

/**
 * Service discovery for Kubernetes environments
 *
 * How it works:
 * 1. Each deployment exposes a Kubernetes Service
 * 2. K8s DNS resolves service names to ClusterIPs
 * 3. Services communicate using: http://service-name.namespace.svc.cluster.local:port
 *    or the short form: http://service-name:port (within same namespace)
 *
 * Discovery pattern:
 * - Services register what they provide (port, protocol, API)
 * - This discovery transforms registrations using K8s service DNS names
 * - Service metadata is stored in ConfigMaps or K8s API annotations
 * - Other services can discover APIs by reading ConfigMaps or querying the K8s API
 *
 * Example Kubernetes manifest:
 * ```yaml
 * apiVersion: v1
 * kind: Service
 * metadata:
 *   name: user-service
 *   namespace: default
 *   annotations:
 *     gg.apis: "UserApi,AuthApi"  # APIs this service provides
 * spec:
 *   selector:
 *     app: user-service
 *   ports:
 *   - port: 8080
 *     targetPort: 8080
 * ```
 */
export class GGKubernetesServiceDiscovery extends GGDiscoveryClient {

    private readonly serviceName: string;
    private readonly namespace: string;
    private readonly useShortNames: boolean;
    private readonly configMapName: string;
    private readonly entries: GGServiceDiscoveryEntry[] = [];

    constructor(options?: {
        serviceName?: string;
        namespace?: string;
        useShortNames?: boolean;  // Use "service-name" vs "service-name.namespace.svc.cluster.local"
        configMapName?: string;
    }) {
        super();
        // Get config from environment or options
        this.serviceName = options?.serviceName ?? process.env.K8S_SERVICE_NAME ?? process.env.SERVICE_NAME ?? 'unknown-service';
        this.namespace = options?.namespace ?? process.env.K8S_NAMESPACE ?? 'default';
        this.useShortNames = options?.useShortNames ?? true; // Default to short names within same namespace
        this.configMapName = options?.configMapName ?? 'gg-service-discovery';
    }

    public registerRoutes(registrations: GGServiceRegistration[]): void {
        // Transform registrations to entries using Kubernetes DNS naming
        for (const reg of registrations) {
            const entry: GGServiceDiscoveryEntry = {
                api: reg.api,
                // Kubernetes DNS naming:
                // Short form: http://service-name:8080 (within same namespace)
                // Full form: http://service-name.namespace.svc.cluster.local:8080
                baseUrl: this.buildKubernetesUrl(reg.protocol, reg.port),
                pathPrefix: reg.pathPrefix
            };
            this.entries.push(entry);
        }
    }

    private buildKubernetesUrl(protocol: string, port: number): string {
        if (this.useShortNames) {
            // Short form: http://user-service:8080
            return `${protocol}://${this.serviceName}:${port}`;
        } else {
            // Full form: http://user-service.default.svc.cluster.local:8080
            return `${protocol}://${this.serviceName}.${this.namespace}.svc.cluster.local:${port}`;
        }
    }

    public async register(): Promise<void> {
        // Register all APIs in a Kubernetes ConfigMap
        // This allows other services to discover available APIs
        try {
            await this.updateConfigMap();
            GGLog.info(this, `Registered ${this.entries.length} APIs in ConfigMap ${this.configMapName}`, {
                apis: this.entries.map(e => e.api)
            });
        } catch (err) {
            GGLog.error(this, `Failed to register APIs in ConfigMap:`, err);
            // Don't throw - service can still work with direct DNS lookups
            GGLog.warn(this, `Service will rely on DNS-based discovery`);
        }
    }

    public async unregister(): Promise<void> {
        // Remove this service's entries from the ConfigMap
        try {
            await this.removeFromConfigMap();
            GGLog.info(this, `Unregistered APIs from ConfigMap ${this.configMapName}`);
        } catch (err) {
            GGLog.error(this, `Failed to unregister APIs from ConfigMap:`, err);
        }
    }

    /**
     * Update the shared ConfigMap with this service's API information
     * Uses the Kubernetes API server (requires appropriate RBAC permissions)
     */
    private async updateConfigMap(): Promise<void> {
        // Get K8s API token from service account
        const token = process.env.K8S_TOKEN;
        if (!token) {
            throw new Error('K8S_TOKEN environment variable not set');
        }

        const k8sApiUrl = process.env.K8S_API_URL ?? 'https://kubernetes.default.svc';

        // Build ConfigMap data
        const configMapData: Record<string, string> = {};
        for (const entry of this.entries) {
            configMapData[entry.api] = JSON.stringify({
                api: entry.api,
                baseUrl: entry.baseUrl,
                pathPrefix: entry.pathPrefix,
                service: this.serviceName,
                namespace: this.namespace
            });
        }

        // Create or update ConfigMap
        const configMap = {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: {
                name: this.configMapName,
                namespace: this.namespace
            },
            data: configMapData
        };

        // Try to update, if it doesn't exist it will be created
        const response = await fetch(
            `${k8sApiUrl}/api/v1/namespaces/${this.namespace}/configmaps/${this.configMapName}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configMap)
            }
        );

        if (!response.ok) {
            // If PUT failed, try POST (create)
            if (response.status === 404) {
                const createResponse = await fetch(
                    `${k8sApiUrl}/api/v1/namespaces/${this.namespace}/configmaps`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(configMap)
                    }
                );

                if (!createResponse.ok) {
                    throw new Error(`Failed to create ConfigMap: ${createResponse.statusText}`);
                }
            } else {
                throw new Error(`Failed to update ConfigMap: ${response.statusText}`);
            }
        }
    }

    private async removeFromConfigMap(): Promise<void> {
        const token = process.env.K8S_TOKEN;
        if (!token) {
            return; // Silently skip if no token
        }

        const k8sApiUrl = process.env.K8S_API_URL ?? 'https://kubernetes.default.svc';

        // Get current ConfigMap
        const response = await fetch(
            `${k8sApiUrl}/api/v1/namespaces/${this.namespace}/configmaps/${this.configMapName}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            return; // ConfigMap doesn't exist, nothing to remove
        }

        const configMap = await response.json() as any;

        // Remove this service's entries
        const data = configMap.data || {};
        for (const entry of this.entries) {
            delete data[entry.api];
        }

        // Update ConfigMap
        configMap.data = data;
        await fetch(
            `${k8sApiUrl}/api/v1/namespaces/${this.namespace}/configmaps/${this.configMapName}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configMap)
            }
        );
    }

    /**
     * Discover an API by name from ConfigMap
     * Reads the shared ConfigMap to find the API location
     */
    public async discoverApi(apiName: string): Promise<string> {
        const token = process.env.K8S_TOKEN;
        if (!token) {
            throw new Error('K8S_TOKEN environment variable not set');
        }

        const k8sApiUrl = process.env.K8S_API_URL ?? 'https://kubernetes.default.svc';

        // Read ConfigMap
        const response = await fetch(
            `${k8sApiUrl}/api/v1/namespaces/${this.namespace}/configmaps/${this.configMapName}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to read ConfigMap: ${response.statusText}`);
        }

        const configMap = await response.json() as any;
        const data = configMap.data || {};

        if (!data[apiName]) {
            throw new Error(`API ${apiName} not found in service discovery ConfigMap`);
        }

        const entry = JSON.parse(data[apiName]);
        return entry.baseUrl + entry.pathPrefix;
    }

    /**
     * Alternative: Discover API using DNS-only (no ConfigMap required)
     * This approach constructs URLs based on K8s naming conventions
     *
     * Example:
     * - serviceName: "user-service"
     * - namespace: "default"
     * - Result: http://user-service.default.svc.cluster.local:8080
     */
    public static discoverApiViaDns(
        serviceName: string,
        options?: {
            namespace?: string;
            port?: number;
            protocol?: string;
            useShortNames?: boolean;
        }
    ): string {
        const namespace = options?.namespace ?? 'default';
        const port = options?.port ?? 8080;
        const protocol = options?.protocol ?? 'http';
        const useShortNames = options?.useShortNames ?? true;

        if (useShortNames) {
            return `${protocol}://${serviceName}:${port}`;
        } else {
            return `${protocol}://${serviceName}.${namespace}.svc.cluster.local:${port}`;
        }
    }
}

/**
 * What consumers need to discover and connect to a service
 */
export interface GGServiceDiscoveryEntry {
    api: string;
    baseUrl: string;     // Complete base URL: "http://localhost:8080" or "http://service-name:8080"
    pathPrefix: string;  // Path to append: "/api/users/"
}

