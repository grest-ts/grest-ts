import {GGServiceDiscoveryEntry} from "../GGLocalDiscoveryClient";

export interface RoutingStrategy {

    select(instances: GGServiceDiscoveryEntry[], path: string): GGServiceDiscoveryEntry;
}

