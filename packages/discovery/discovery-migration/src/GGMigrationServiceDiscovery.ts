import {GGDiscoveryClient, GGServiceRegistration} from "@grest-ts/discovery";
import {GGLog} from "@grest-ts/logger";

/**
 * Migration wrapper for zero-downtime service discovery migrations
 *
 * Allows you to migrate from one discovery strategy to another without downtime:
 * - Registers with BOTH old and new discovery systems
 * - Discovers from ONE system (configurable)
 * - Gradually migrate services from old → new
 *
 * Migration Path Example (Static → Consul):
 *
 * Phase 1: Dual Registration (discover from OLD)
 * ```typescript
 * new GGMigrationServiceDiscovery({
 *   old: new GGStaticServiceDiscovery(),
 *   new: new GGDockerServiceDiscovery(),
 *   discoverFrom: 'old'  // Still use old for discovery
 * });
 * ```
 * → All services register with both Static and Consul
 * → All services discover from Static URLs
 * → Consul is being populated but not used yet
 *
 * Phase 2: Switch Discovery (discover from NEW)
 * ```typescript
 * new GGMigrationServiceDiscovery({
 *   old: new GGStaticServiceDiscovery(),
 *   new: new GGDockerServiceDiscovery(),
 *   discoverFrom: 'new'  // Switch to Consul!
 * });
 * ```
 * → All services still register with both
 * → All services now discover from Consul
 * → Can rollback to 'old' if issues
 *
 * Phase 3: Complete Migration (use only NEW)
 * ```typescript
 * new GGDockerServiceDiscovery();
 * ```
 * → Remove migration wrapper
 * → Only use Consul
 * → Remove old static configuration
 */
export class GGMigrationServiceDiscovery extends GGDiscoveryClient {

    private readonly oldDiscovery: GGDiscoveryClient;
    private readonly newDiscovery: GGDiscoveryClient;
    private readonly discoverFrom: 'old' | 'new';

    constructor(options: {
        old: GGDiscoveryClient;
        new: GGDiscoveryClient;
        discoverFrom: 'old' | 'new';
    }) {
        super();
        this.oldDiscovery = options.old;
        this.newDiscovery = options.new;
        this.discoverFrom = options.discoverFrom;

        GGLog.info(this, `Migration mode: registering with BOTH, discovering from '${this.discoverFrom}'`);
    }

    public registerRoutes(registrations: GGServiceRegistration[]): void {
        // Register with BOTH old and new discovery systems
        GGLog.debug(this, `Registering ${registrations.length} routes with OLD discovery...`);
        this.oldDiscovery.registerRoutes(registrations);

        GGLog.debug(this, `Registering ${registrations.length} routes with NEW discovery...`);
        this.newDiscovery.registerRoutes(registrations);
    }

    public async register(): Promise<void> {
        // Register with BOTH systems
        GGLog.info(this, 'Registering with OLD discovery...');
        await this.oldDiscovery.register();

        GGLog.info(this, 'Registering with NEW discovery...');
        await this.newDiscovery.register();

        GGLog.info(this, `Migration registration complete. Discovering from '${this.discoverFrom}' discovery.`);
    }

    public async unregister(): Promise<void> {
        // Unregister from BOTH systems
        GGLog.info(this, 'Unregistering from OLD discovery...');
        await this.oldDiscovery.unregister().catch(err => {
            GGLog.error(this, 'Failed to unregister from OLD discovery:', err);
        });

        GGLog.info(this, 'Unregistering from NEW discovery...');
        await this.newDiscovery.unregister().catch(err => {
            GGLog.error(this, 'Failed to unregister from NEW discovery:', err);
        });
    }

    public async discoverApi(apiName: string): Promise<string> {
        // Discover from configured system (old or new)
        const activeDiscovery = this.discoverFrom === 'old' ? this.oldDiscovery : this.newDiscovery;

        GGLog.debug(this, `Discovering ${apiName} from '${this.discoverFrom}' discovery`);

        try {
            return await activeDiscovery.discoverApi(apiName);
        } catch (err) {
            GGLog.error(this, `Failed to discover ${apiName} from '${this.discoverFrom}' discovery:`, err);

            // Optional: Try fallback to other discovery
            if (this.shouldFallback()) {
                const fallbackDiscovery = this.discoverFrom === 'old' ? this.newDiscovery : this.oldDiscovery;
                const fallbackName = this.discoverFrom === 'old' ? 'new' : 'old';

                GGLog.warn(this, `Attempting fallback to '${fallbackName}' discovery...`);

                try {
                    const result = await fallbackDiscovery.discoverApi(apiName);
                    GGLog.info(this, `Fallback successful! Discovered ${apiName} from '${fallbackName}' discovery`);
                    return result;
                } catch (fallbackErr) {
                    GGLog.error(this, `Fallback also failed:`, fallbackErr);
                }
            }

            throw err;
        }
    }

    /**
     * Enable/disable automatic fallback to other discovery system
     * Override this if you want different fallback behavior
     */
    protected shouldFallback(): boolean {
        // By default, enable fallback during migration
        // This makes migration safer - if new discovery fails, fall back to old
        return true;
    }
}
