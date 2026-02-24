import {GGMetricsStore} from "./GGMetricsStore";
import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator";

export const GG_METRICS = new GGLocatorKey<GGMetricsStore>("GGMetrics");

export class GGMetricsLoader {

    private readonly store: GGMetricsStore;

    constructor(store?: GGMetricsStore) {
        this.store = store ?? new GGMetricsStore();

        GGLocator.getScope().setWithLifecycle(GG_METRICS, this.store, {
            type: GGLocatorServiceType.CONFIG + 1,
            start: async () => {
            },
            teardown: async () => {
            }
        })
    }
}
