import type {GGHeaderSchema, GGTransportMiddleware} from "@grest-ts/context"

/**
 * Decides the API's `GGRequirement` permissions. List it in the schema's `use:` next to its credential wires;
 * bind the decision server-side with `.define(factory).create(deps)` (the node half). It runs after the input
 * is validated and before the implementation. Carries nothing over the wire, so the browser bundle can list it.
 */
export class GGAuthority implements GGTransportMiddleware {
    public readonly name: string
    /** Reads no headers; declared so the class is a middleware for `use:`. */
    public readonly headers: Readonly<Record<string, GGHeaderSchema>> = Object.freeze({})

    constructor(name: string) {
        this.name = name
    }
}
