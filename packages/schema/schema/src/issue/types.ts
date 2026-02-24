// ---------------------------------------------------------
// FlattenDiscriminated - Converts a discriminated union into a flat object type.
//
// SQL and other flat data sources return all columns regardless of discriminant value,
// so this type represents the "flat" shape that a discriminated union maps to in storage.
//
// - Keys present in ALL variants remain required
// - Keys present in only SOME variants become optional
// - Recurses into object properties, arrays, and nested discriminated unions
//
// Example:
//   type T = {type: 'a', shared: string, onlyA: number} | {type: 'b', shared: string}
//   FlattenDiscriminated<T> = {type: 'a' | 'b', shared: string, onlyA?: number}
// ---------------------------------------------------------

// Collect all keys across all members of a union
type _FD_AllKeys<T> = T extends any ? keyof T : never;

// Check if T is a union of non-primitive objects (i.e., a discriminated union candidate).
// Uses IsUnion internally (distributive) but the final check is non-distributive via [T] extends [...].
// Excludes primitive unions like `string | null` or branded type unions like `RegCode | PersonCode`.
type _FD_IsUnion<T, C = T> = T extends any
    ? [C] extends [T] ? false : true
    : false;
type _FD_IsObjectUnion<T> =
    _FD_IsUnion<T> extends true
        ? [T] extends [string | number | boolean | symbol | bigint | null | undefined | Function]
            ? false
            : true
        : false;

// Extract the value type for key K across all members of union T.
// Uses distributive conditional + indexed access instead of Record<K, infer V>,
// because Record requires the key to be non-optional which fails for optional properties.
type _FD_ValueOf<T, K extends PropertyKey> = T extends any ? (K extends keyof T ? T[K] : never) : never;

// Core flattening: merge all variants into one flat object, make exclusive keys optional.
type _FD_FlattenUnion<T> =
    { [K in _FD_AllKeys<T> as K extends keyof T ? K : never]: _FD_Recurse<_FD_ValueOf<T, K>> } &
    { [K in _FD_AllKeys<T> as K extends keyof T ? never : K]?: _FD_Recurse<_FD_ValueOf<T, K>> };

// Entry point: non-distributive check for object union, then recurse into the (flattened) result.
// _FD_IsObjectUnion<T> extends true is non-distributive (checked type is not a naked T),
// so the union is preserved for FlattenUnion instead of being distributed to individual members.
type _FD_Recurse<T> =
    _FD_IsObjectUnion<T> extends true
        ? _FD_RecurseSingle<_FD_FlattenUnion<T>>
        : _FD_RecurseSingle<T>;

// Recurse into a single (non-union) type's properties. Distributive here is fine
// because the union has already been flattened by the caller.
type _FD_RecurseSingle<T> =
    T extends null | undefined ? T :
        T extends string | number | boolean | symbol | bigint ? T :
            T extends Function ? T :
                T extends Array<infer U> ? _FD_Recurse<U>[] :
                    T extends ReadonlyArray<infer U> ? readonly _FD_Recurse<U>[] :
                        T extends object ? { [K in keyof T]: _FD_Recurse<T[K]> } : T;

export type FlattenDiscriminated<T> = _FD_Recurse<T>;

export type Raw<T> =
// Handle null and undefined first (before other checks)
    T extends null ? null :
        T extends undefined ? undefined :

            // Handle primitives - strip brands but preserve literals
            // Branded types are intersections like `string & { __brand }` which extend both primitive AND object
            // Literal types like "foo" are pure primitives (don't extend object)
            // So: if T extends primitive AND object → branded → strip to base primitive
            //     if T extends primitive only → literal or plain → preserve as-is
            T extends string ? (T extends object ? string : T) :
                T extends number ? (T extends object ? number : T) :
                    T extends boolean ? (T extends object ? boolean : T) :
                        T extends symbol ? (T extends object ? symbol : T) :
                            T extends bigint ? (T extends object ? bigint : T) :
                                // Handle functions (preserve as-is, don't recurse)
                                T extends Function ? T :
                                    // Handle arrays (must come before object check as arrays are objects)
                                    T extends Array<infer U> ? Raw<U>[] :
                                        T extends ReadonlyArray<infer U> ? readonly Raw<U>[] :
                                            // Handle objects recursively - map over properties
                                            T extends object ? { [K in keyof T]: Raw<T[K]> } :
                                                // Otherwise keep the type as-is (catches unknown, any, never, etc.)
                                                T;

