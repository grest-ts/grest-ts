import {GGContextKey} from "@grest-ts/context";
import {GGPermissionChecker, IsAny} from "@grest-ts/schema";

/**
 * Per-request permission context populated by the gate from the schema's wire
 * scopes. Handler code can read it to make sub-decisions inside an authorized
 * method:
 *
 *     const perm = GG_PERMISSIONS.get();
 *     if (perm.has(AppPermission.Admin)) { ... }
 *
 * The checker uses the same satisfies() the framework gate uses — no parallel
 * implementations.
 */
export const GG_PERMISSIONS = new GGContextKey<GGPermissionChecker>("permissions", IsAny as any);
