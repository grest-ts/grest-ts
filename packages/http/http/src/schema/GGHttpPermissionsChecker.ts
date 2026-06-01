import {GGWireContextKey} from "./GGWireContextKey";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {FORBIDDEN, GGPermission, GGPermissionChecker} from "@grest-ts/schema";

export class GGHttpPermissionsChecker {

    private readonly middlewaresWithPermissions: GGWireContextKey[] = []

    constructor(apiMiddlewares: readonly GGTransportMiddleware[]) {
        for (const mw of apiMiddlewares) {
            if (mw instanceof GGWireContextKey && mw.hasPermissions()) {
                this.middlewaresWithPermissions.push(mw);
            }
        }
        Object.freeze(this.middlewaresWithPermissions)
    }

    public async assert(schema: string, method: string, required: GGPermission): Promise<undefined | ReadonlyArray<ReadonlyArray<string>>> {
        if (this.middlewaresWithPermissions.length > 0) {
            const scopes: Array<readonly string[]> = [];
            for (let i = 0; i < this.middlewaresWithPermissions.length; i++) {
                scopes.push(await this.middlewaresWithPermissions[i].permissions())
            }
            this.assertScopes(schema, method, scopes, required)
            return Object.freeze(scopes) as readonly string[][]
        }
        return undefined
    }

    public assertScopes(schema: string, method: string, scopes: undefined | ReadonlyArray<ReadonlyArray<string>>, required: GGPermission): void {
        if (!GGPermissionChecker.satisfies(required, scopes)) {
            throw new FORBIDDEN({
                debugMessage: `${schema + (method ? "." + method : "")} requires ${GGPermissionChecker.describePermission(required)} — caller scopes did not satisfy`
            })
        }
    }

}