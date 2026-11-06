import {GGWireContextKey} from "./GGWireContextKey";
import {GGWireAlternatives} from "./GGWireAlternatives";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {FORBIDDEN, GGPermission, GGPermissionChecker} from "@grest-ts/schema";

export class GGHttpPermissionsChecker {

    private readonly sources: (GGWireContextKey | GGWireAlternatives)[] = []

    constructor(apiMiddlewares: readonly GGTransportMiddleware[]) {
        for (const mw of apiMiddlewares) {
            if (mw instanceof GGWireContextKey || mw instanceof GGWireAlternatives) this.sources.push(mw);
        }
        Object.freeze(this.sources)
    }

    // Resolved per call, not at construction: a wire's handler may be created after the
    // schema is registered (any time before start), and its grants must still count.
    public async assert(schema: string, method: string, required: GGPermission | undefined): Promise<ReadonlyArray<ReadonlyArray<string>>> {
        const scopes: Array<readonly string[]> = [];
        for (const wire of this.sources.flatMap(s => s instanceof GGWireAlternatives ? s.activeWires() : [s])) {
            if (wire.hasPermissions()) scopes.push(await wire.getGrantedPermissions())
        }
        this.assertGrants(schema, method, scopes, required)
        return Object.freeze(scopes) as readonly string[][]
    }

    public assertGrants(schema: string, method: string, granted: undefined | ReadonlyArray<ReadonlyArray<string>>, required: GGPermission | undefined): void {
        if (required === undefined) return
        if (!GGPermissionChecker.satisfies(required, granted)) {
            throw new FORBIDDEN({
                debugMessage: `${schema + (method ? "." + method : "")} requires ${GGPermissionChecker.describePermission(required)} - caller scopes did not satisfy`
            })
        }
    }

}