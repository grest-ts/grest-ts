import {GGWireContextKey} from "./GGWireContextKey";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {FORBIDDEN, GGPermission, GGPermissionChecker} from "@grest-ts/schema";

export class GGHttpPermissionsChecker {

    private readonly wires: GGWireContextKey[] = []

    constructor(apiMiddlewares: readonly GGTransportMiddleware[]) {
        for (const mw of apiMiddlewares) {
            if (mw instanceof GGWireContextKey) this.wires.push(mw);
        }
        Object.freeze(this.wires)
    }

    // Resolved per call, not at construction: a wire's handler may be created after the
    // schema is registered (any time before start), and its grants must still count.
    public async assert(schema: string, method: string, required: GGPermission | undefined): Promise<ReadonlyArray<ReadonlyArray<string>>> {
        const scopes: Array<readonly string[]> = [];
        for (let i = 0; i < this.wires.length; i++) {
            if (this.wires[i].hasPermissions()) scopes.push(await this.wires[i].getGrantedPermissions())
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