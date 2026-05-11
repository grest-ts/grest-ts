export const GG_NO_PERMISSIONS = Symbol.for("@grest-ts/permission/none")
export const GG_ANY_PERMISSION = Symbol.for("@grest-ts/permission/any")

export type GGPermission =
    | typeof GG_NO_PERMISSIONS
    | typeof GG_ANY_PERMISSION
    | string
    | {allOf: readonly [GGPermission, ...GGPermission[]]}
    | {anyOf: readonly [GGPermission, ...GGPermission[]]}
