/**
 * Test extension for HttpApiSchema - adds routing property
 */

import {GGLocalRoutingStrategySelector} from "@grest-ts/discovery-local/testkit"
import type {GGApiRoutingSelector} from "./GGApiRoutingSelector"
import {GGHttpSchema} from "../../src/schema/GGHttpSchema";
import {GGContractApiDefinition} from "@grest-ts/schema";

// WeakMap to store per-instance routing selectors
const routingSelectors = new WeakMap<GGHttpSchema<any>, GGLocalRoutingStrategySelector>()

// Module augmentation
declare module "../../src/schema/GGHttpSchema" {
    interface GGHttpSchema<TContract extends GGContractApiDefinition> {
        /**
         * Routing selector for this API (for testing)
         */
        readonly routing: GGApiRoutingSelector
    }
}

// Add routing to HttpApiSchema prototype
Object.defineProperty(GGHttpSchema.prototype, 'routing', {
    get(this: GGHttpSchema<any>) {
        let selector = routingSelectors.get(this)
        if (!selector) {
            selector = new GGLocalRoutingStrategySelector(this.name)
            routingSelectors.set(this, selector)
        }
        return selector
    },
    enumerable: false,
    configurable: true
})
