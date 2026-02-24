import {GGExtensionDiscovery} from '@grest-ts/common';

/**
 * Discovers testkit extensions by scanning node_modules for packages
 * that follow the convention of having a testkit/index-testkit.ts file.
 *
 * @deprecated Use GGExtensionDiscovery from @grest-ts/common directly:
 * ```typescript
 * const discovery = new GGExtensionDiscovery('testkit');
 * await discovery.load();
 * ```
 */
export class GGTestkitExtensionsDiscovery {

    private static discovery = new GGExtensionDiscovery('testkit');

    /**
     * Discover and load all testkits.
     * - Scans for testkit packages
     * - Generates .d.ts file for IDE support
     * - Dynamically imports testkits for runtime
     */
    public static async load(): Promise<void> {
        await this.discovery.load();
    }
}
