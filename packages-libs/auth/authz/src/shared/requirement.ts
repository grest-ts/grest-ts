import {FORBIDDEN, type GGRequirement, type GGRequirementResource, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {APPROVAL_REQUIRED, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED} from "./authzErrors"

/** What an authority deciding a requirement may throw; grest-ts merges them into the method's errors. */
export const GG_AUTHZ_ERRORS = Object.freeze([NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, APPROVAL_REQUIRED, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED] as const)
export type GGAuthzError = typeof GG_AUTHZ_ERRORS[number]

export interface GGAuthzRequirement<Field extends string = never, Types extends string = string> extends GGRequirement<Field, GGAuthzError> {
    /** A denial answers NOT_FOUND, so the resource's existence doesn't leak. */
    hide(): GGAuthzRequirement<Field, Types>
    /** An upsert: when the id field is absent, check `type` (one of the action's, the parent) from `field` instead;
     *  without `field`, the parent is the caller's tenant. */
    orCreateOn(type: Types): GGAuthzRequirement<Field, Types>
    orCreateOn<const F extends string>(type: Types, field: F): GGAuthzRequirement<Field | F, Types>
}

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never

/** `Own`: the types the action names; `Types`: those and the parents they can be in. */
export interface GGAuthzActionBuilders<Own extends string, Types extends string = Own> {
    /** On the tenant itself, e.g. a create checked on the caller's org. */
    on<T extends Types>(type: T): GGAuthzRequirement<never, Types>
    /** The resource id is that input field (the action must name one resource type). */
    on<const F extends string>(field: IsUnion<Own> extends true ? never : F): GGAuthzRequirement<F, Types>
    on<T extends Types, const F extends string>(type: T, field: F): GGAuthzRequirement<F, Types>
    /** The authority resolves the id from the request, e.g. the document the caller has open. */
    onContext(source: string): GGAuthzRequirement<never, Types>
    onContext<T extends Types>(type: T, source: string): GGAuthzRequirement<never, Types>
    /** Inside the parent that input field names (a `{type, id}` from `parentRef`), decided on that parent: a create or
     *  a list. The action must have one type with `in`, or name it. */
    in<const F extends string>(field: F): GGAuthzRequirement<F, Types>
    in<T extends Own, const F extends string>(type: T, field: F): GGAuthzRequirement<F, Types>
    /** No check before the handler; it filters what it returns. */
    list(): GGRequirement<never, GGAuthzError>
}

interface Parts {
    resource?: GGRequirementResource
    createOn?: GGRequirementResource
    list?: true
    hidden?: true
}

function requirement(action: string, resourceTypes: readonly string[], parts: Parts): GGAuthzRequirement<string> {
    const data = {__permission: "requirement", action, ...parts, errors: GG_AUTHZ_ERRORS}
    for (const r of [parts.resource, parts.createOn]) {
        if (r?.id) Object.freeze(r.id)
        if (r?.in) Object.freeze(r.in)
        if (r) Object.freeze(r)
    }
    Object.defineProperties(data, {
        hide: {value: () => requirement(action, resourceTypes, {...parts, hidden: true})},
        orCreateOn: {value: (type: string, field?: string) => {
            if (!parts.resource?.id || !("field" in parts.resource.id)) throw new Error(`${action}: orCreateOn needs a resource id from an input field`)
            if (!resourceTypes.includes(type)) throw new Error(`${action} doesn't apply to ${type}`)
            return requirement(action, resourceTypes, {...parts, createOn: field === undefined ? {type} : {type, id: {field}}})
        }},
    })
    return Object.freeze(data) as unknown as GGAuthzRequirement<string>
}

/** The builders on a defined action; non-enumerable, so the action still reads as plain data. */
export function actionBuilders(action: string, resourceTypes: readonly string[], own: readonly string[], parents: ReadonlyMap<string, readonly string[]>): PropertyDescriptorMap {
    const typeOf = (type: string | undefined) => {
        if (type === undefined) {
            if (own.length !== 1) throw new Error(`${action} applies to ${own.join(", ")}: name the type`)
            return own[0]!
        }
        if (!resourceTypes.includes(type)) throw new Error(`${action} doesn't apply to ${type}`)
        return type
    }
    const on = (a: string, b?: string) => {
        if (b !== undefined) return requirement(action, resourceTypes, {resource: {type: typeOf(a), id: {field: b}}})
        if (a.includes(":")) return requirement(action, resourceTypes, {resource: {type: typeOf(a)}})
        return requirement(action, resourceTypes, {resource: {type: typeOf(undefined), id: {field: a}}})
    }
    const onContext = (a: string, b?: string) => b === undefined
        ? requirement(action, resourceTypes, {resource: {type: typeOf(undefined), id: {context: a}}})
        : requirement(action, resourceTypes, {resource: {type: typeOf(a), id: {context: b}}})
    const within = (a: string, b?: string) => {
        const type = b === undefined ? [...parents.keys()] : [a]
        if (b === undefined && type.length !== 1) throw new Error(`${action}: ${type.length ? `${type.join(", ")} have` : "none of its types has"} \`in\`: name the type`)
        const types = parents.get(type[0]!)
        if (!types) throw new Error(`${action}: ${type[0]} has no \`in\`, or the action isn't on it`)
        return requirement(action, resourceTypes, {resource: {type: type[0]!, in: {field: b ?? a, types}}})
    }
    return {
        on: {value: on},
        onContext: {value: onContext},
        in: {value: within},
        list: {value: () => requirement(action, resourceTypes, {list: true})},
    }
}
