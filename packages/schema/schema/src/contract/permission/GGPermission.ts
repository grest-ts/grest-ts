/**
 * Permission sentinels. Frozen singleton objects with a discriminating
 * readonly literal property. Two reasons over `Symbol.for(...)`:
 *
 *  1. **Type-level strictness.** Unique symbols widen to `symbol` in object
 *     property positions, which leaks past type checks and admits arbitrary
 *     symbols. A `{readonly __permission: "none"}` literal does NOT widen
 *     and the type system rejects anything else.
 *  2. **Cheap runtime identity.** Singleton + `===` is identical in cost to
 *     a symbol comparison; the `Object.freeze` ensures user code can't
 *     mutate the marker into something that looks like another.
 *
 * Combinator shapes (`{allOf: ...}`, `{anyOf: ...}`) are structurally
 * distinct (different key names) and so do not collide with these sentinels.
 */
export const GG_NO_PERMISSIONS = Object.freeze({__permission: "none"} as const);
export const GG_ANY_PERMISSION = Object.freeze({__permission: "any"} as const);

export type GG_NO_PERMISSIONS = typeof GG_NO_PERMISSIONS;
export type GG_ANY_PERMISSION = typeof GG_ANY_PERMISSION;

export type GGPermission =
    | GG_NO_PERMISSIONS
    | GG_ANY_PERMISSION
    | string
    | {allOf: readonly [GGPermission, ...GGPermission[]]}
    | {anyOf: readonly [GGPermission, ...GGPermission[]]}
