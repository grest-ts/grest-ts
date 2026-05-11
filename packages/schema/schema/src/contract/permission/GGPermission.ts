export const GG_NO_PERMISSIONS: symbol = Symbol.for("@grest-ts/permission/none")
export const GG_ANY_PERMISSION: symbol = Symbol.for("@grest-ts/permission/any")

export type GGPermission =
    | symbol
    | string
    | {allOf: readonly [GGPermission, ...GGPermission[]]}
    | {anyOf: readonly [GGPermission, ...GGPermission[]]}
