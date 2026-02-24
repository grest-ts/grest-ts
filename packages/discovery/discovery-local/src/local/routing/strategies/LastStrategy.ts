import {RoutingStrategy} from "../RoutingStrategy";
import {GGServiceDiscoveryEntry} from "../../GGLocalDiscoveryClient";

/**
 * Always route to the last registered instance.
 */
export class LastStrategy implements RoutingStrategy {
    select(instances: GGServiceDiscoveryEntry[]): GGServiceDiscoveryEntry {
        return instances[instances.length - 1];
    }
}