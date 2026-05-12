import {GGPermission} from "./GGPermission";
import {satisfies} from "./satisfies";

export class GGPermissionChecker {
    public readonly scopes: ReadonlySet<string>

    constructor(scopes: ReadonlySet<string>) {
        this.scopes = scopes
        Object.freeze(this)
    }

    public has(permission: GGPermission): boolean {
        return satisfies(permission, this.scopes)
    }
}
