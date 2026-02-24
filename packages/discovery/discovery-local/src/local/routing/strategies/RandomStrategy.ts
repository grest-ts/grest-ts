import {RoutingStrategy} from "../RoutingStrategy";
import {GGServiceDiscoveryEntry} from "../../GGLocalDiscoveryClient";

/**
 * Randomly select an instance for each request.
 */
export class RandomStrategy implements RoutingStrategy {
    select(instances: GGServiceDiscoveryEntry[]): GGServiceDiscoveryEntry {
        return instances[Math.floor(Math.random() * instances.length)];
    }
}