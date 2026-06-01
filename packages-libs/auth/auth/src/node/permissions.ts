import {GGPermission, GGPermissionChecker} from "@grest-ts/schema"

// Wrap held permissions so allOf/anyOf gate checks work via grest-ts's satisfies().
// grest-ts speaks scopes as an array of per-source arrays; the lib holds one source.
export function permissionsChecker(permissions: Iterable<string>): {has(required: GGPermission): boolean} {
    const scopes = [[...permissions]]
    return {has: (required) => GGPermissionChecker.satisfies(required, scopes)}
}
