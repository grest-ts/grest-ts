import {GGPermissionChecker} from "@grest-ts/schema"

// Wrap held permissions in grest-ts's GGPermissionChecker so allOf/anyOf gate checks
// work. grest-ts speaks scopes as an array of per-source arrays; the lib holds one source.
export function permissionsChecker(permissions: Iterable<string>): GGPermissionChecker {
    return new GGPermissionChecker([[...permissions]])
}
