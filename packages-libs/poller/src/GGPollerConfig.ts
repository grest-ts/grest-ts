import {GGResource} from "@grest-ts/config";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";


/**
 * Configuration for a poller using the GGConfig pattern.
 *
 * @example
 * ```typescript
 * // Define in your config
 * export const EmailPollerConfig = new GGPollerConfig('email-sender');
 *
 * // Create poller with this config
 * const poller = new GGPoller(EmailPollerConfig, lock, {
 *   getData: (limit) => db.getPendingEmails(limit),
 *   run: async (email) => { await sendEmail(email); },
 *   onCompleted: (report) => log.info('batch done', report),
 * });
 *
 * await poller.start();
 * ```
 */
export class GGPollerConfig {
    /**
     * The unique identifier for this poller (used as lock name).
     * Stable across deployments - do not derive from code structure.
     */
    public readonly lockName: string;

    /**
     * Configuration resource for runtime settings.
     */
    public readonly settings: GGResource<GGPollerConfigData>;

    constructor(lockName: string) {
        this.lockName = lockName;
        this.settings = new GGResource(
            lockName + "/settings",
            IsPollerConfigData,
            "Poller configuration"
        );
    }
}


const IsPollerConfigData = IsObject({
    lockTtlMs: IsNumber.orUndefined,
    heartbeatIntervalMs: IsNumber.orUndefined,
    pollIntervalMs: IsNumber.orUndefined,
    batchSize: IsNumber.orUndefined,
    concurrency: IsNumber.orUndefined,
    retryAcquireIntervalMs: IsNumber.orUndefined,
    instanceId: IsString.orUndefined,
});

export type GGPollerConfigData = typeof IsPollerConfigData.infer;
