import {GGPermissionChecker} from "@grest-ts/schema"

// Wrap held permissions in grest-ts's GGPermissionChecker so allOf/anyOf gate checks
// work. The lib carries permissions as the Set<string> grest-ts speaks; no own algebra.
export function permissionsChecker(permissions: Iterable<string>): GGPermissionChecker {
    return new GGPermissionChecker(new Set(permissions))
}
