import {RoutingStrategy} from "../RoutingStrategy";
import {GGServiceDiscoveryEntry} from "../../GGLocalDiscoveryClient";

/**
 * Always route to the first registered instance.
 */
export class FirstStrategy implements RoutingStrategy {
    select(instances: GGServiceDiscoveryEntry[]): GGServiceDiscoveryEntry {
        return instances[0];
    }
}