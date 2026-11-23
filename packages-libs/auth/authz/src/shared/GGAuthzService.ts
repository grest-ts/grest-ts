import {deepFreeze} from "@grest-ts/common"
import {IsLiteral, IsObject, IsString, type GGSchema} from "@grest-ts/schema"
import {IsGGAuthzActionName, IsGGAuthzResourceType} from "./authzSchemas"
import {definedAt, register} from "./definitions"
import {actionBuilders, type GGAuthzActionBuilders} from "./requirement"

export interface GGAuthzDefinedAction<Name extends string = string, Own extends string = string, Types extends string = Own> extends GGAuthzActionBuilders<Own, Types> {
    readonly name: Name
    /** The types it names and the parents they can be in. */
    readonly resourceTypes: readonly Types[]
    readonly description?: string
}

/** `on`: the service's own types, or another service's as `service:type` (e.g. a create checked on its parent). */
export interface GGAuthzActionSpec<Type extends string> {
    on: readonly (Type | `${string}:${string}`)[]
    description?: string
}

/** A type with `in` can live inside those types (its own, or another service's as `service:type`): every action on it
 *  also applies to them, so a create or a list is decided on the parent. */
export type GGAuthzTypeSpec = string | {readonly description: string, readonly in?: readonly string[]}

export interface GGAuthzServiceSpec<Types extends Record<string, GGAuthzTypeSpec>, Actions extends Record<string, GGAuthzActionSpec<keyof Types & string>>> {
    description?: string
    types?: Types
    actions: Actions
}

type TypeName<Service extends string, T> = T extends `${string}:${string}` ? T : T extends string ? `${Service}:${T}` : never
type ParentsOf<Service extends string, S> = S extends {in: readonly (infer P)[]} ? TypeName<Service, P> : never
/** `{type, id}` naming a parent a `T` can be in. */
export type GGAuthzParentRef<Type extends string = string> = {type: Type, id: string}

export interface GGAuthzService<Service extends string = string, Types extends Record<string, GGAuthzTypeSpec> = Record<string, GGAuthzTypeSpec>> {
    readonly name: Service
    readonly all: `${Service}:*`
    readonly description?: string
    readonly types: {readonly [K in keyof Types & string]: `${Service}:${K}`}
    readonly resourceTypes: readonly {readonly name: string, readonly description: string, readonly in?: readonly string[]}[]
    /** The input schema of a field naming the parent a `type` is created or listed in, for `.in(field)`. */
    parentRef<const K extends {[T in keyof Types & string]: Types[T] extends {in: readonly string[]} ? T : never}[keyof Types & string]>(type: K): GGSchema<GGAuthzParentRef<ParentsOf<Service, Types[K]>>>
    readonly actions: readonly GGAuthzDefinedAction[]
    readonly definedAt?: string
}

/** A service as `define` returns it: each action is also a property, e.g. `Docs.Read`. */
export type GGAuthzDefinedService<Service extends string = string, Types extends Record<string, GGAuthzTypeSpec> = Record<string, GGAuthzTypeSpec>, Actions extends Record<string, GGAuthzActionSpec<string>> = {}> =
    GGAuthzService<Service, Types>
    & {readonly [K in keyof Actions & string]: GGAuthzDefinedAction<`${Service}:${K}`, TypeName<Service, Actions[K]["on"][number]>, TypeName<Service, Actions[K]["on"][number]> | ParentsOf<Service, Types[Actions[K]["on"][number] & keyof Types]>>}

/** A service is a frozen plain object; the class holds only `define`. */
export abstract class GGAuthzService<Service extends string = string, Types extends Record<string, GGAuthzTypeSpec> = Record<string, GGAuthzTypeSpec>> {
    static define<const Service extends string, const Types extends Record<string, GGAuthzTypeSpec> = {}, const Actions extends Record<string, GGAuthzActionSpec<NoInfer<keyof Types & string>>> = {}>(
        name: Service,
        spec: GGAuthzServiceSpec<Types, Actions>,
    ): GGAuthzDefinedService<Service, Types, Actions> {
        const types: Record<string, string> = {}
        for (const type of Object.keys(spec.types ?? {})) types[type] = IsGGAuthzResourceType.parse(`${name}:${type}`)
        const typeName = (type: string, at: string) => {
            if (type.includes(":")) return IsGGAuthzResourceType.parse(type)
            if (!(type in types)) throw new Error(`${at} is on unknown type ${type}`)
            return types[type]!
        }
        const parents = new Map<string, readonly string[]>()
        const resourceTypes = Object.entries<GGAuthzTypeSpec>(spec.types ?? {}).map(([type, s]) => {
            if (typeof s === "string") return {name: types[type]!, description: s}
            const within = s.in?.map(t => typeName(t, `Type ${name}:${type}`))
            if (within?.length) parents.set(types[type]!, within)
            return {name: types[type]!, description: s.description, ...within && {in: within}}
        })
        const actions: GGAuthzDefinedAction[] = []
        const service: Record<string, unknown> = {name, all: `${name}:*`, description: spec.description, types, resourceTypes, actions, definedAt: definedAt()}
        for (const [key, action] of Object.entries<GGAuthzActionSpec<string>>(spec.actions)) {
            if (!/^[A-Z]/.test(key)) throw new Error(`Action ${name}:${key} must start with an upper-case letter`)
            const own = action.on.map(type => typeName(type, `Action ${name}:${key}`))
            const resource = [...new Set([...own, ...own.flatMap(t => parents.get(t) ?? [])])]
            const actionName = IsGGAuthzActionName.parse(`${name}:${key}`)
            const defined = Object.defineProperties({name: actionName, resourceTypes: resource, description: action.description}, actionBuilders(actionName, resource, own, new Map(own.flatMap(t => parents.has(t) ? [[t, parents.get(t)!] as const] : [])))) as unknown as GGAuthzDefinedAction
            actions.push(defined)
            service[key] = defined
        }
        Object.defineProperty(service, "parentRef", {value: (type: string) => {
            const within = parents.get(types[type] ?? "")
            if (!within) throw new Error(`Type ${name}:${type} has no \`in\``)
            return IsObject({type: IsLiteral(...within), id: IsString.nonEmpty})
        }})
        return register("service", name, deepFreeze(service)) as GGAuthzDefinedService<Service, Types, Actions>
    }
}
