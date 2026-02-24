import {RoutingStrategy} from "../RoutingStrategy";
import {GGServiceDiscoveryEntry} from "../../GGLocalDiscoveryClient";

/**
 * Cycle through instances in order, per path.
 * Each unique path maintains its own counter.
 */
export class RoundRobinStrategy implements RoutingStrategy {
    private readonly counters: Map<string, number> = new Map();

    select(instances: GGServiceDiscoveryEntry[], path: string): GGServiceDiscoveryEntry {
        const counter = this.counters.get(path) ?? 0;
        const instance = instances[counter % instances.length];
        this.counters.set(path, counter + 1);
        return instance;
    }
}