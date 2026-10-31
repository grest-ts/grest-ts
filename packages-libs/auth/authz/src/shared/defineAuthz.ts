import {deepFreeze} from "@grest-ts/common"
import {expandActions, expandRoles} from "./chain"
import {IsLiteral, IsObject, IsString, type GGSchema} from "@grest-ts/schema"
import {actionBuilders, type GGAuthzActionBuilders} from "./requirement"
import {type GGAuthzApprovalLevel, type GGAuthzCondition, type GGAuthzModel, type GGAuthzRule, IsGGAuthzActionName, IsGGAuthzModel, IsGGAuthzResourceType} from "./authzSchemas"

export type GGAuthzActionRef = string | {readonly name: string}

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

export type GGAuthzService<Service extends string = string, Types extends Record<string, GGAuthzTypeSpec> = Record<string, GGAuthzTypeSpec>, Actions extends Record<string, GGAuthzActionSpec<string>> = {}> = {
    readonly name: Service
    readonly all: `${Service}:*`
    readonly description?: string
    readonly types: {readonly [K in keyof Types & string]: `${Service}:${K}`}
    readonly resourceTypes: readonly {readonly name: string, readonly description: string, readonly in?: readonly string[]}[]
    /** The input schema of a field naming the parent a `type` is created or listed in, for `.in(field)`. */
    parentRef<const K extends {[T in keyof Types & string]: Types[T] extends {in: readonly string[]} ? T : never}[keyof Types & string]>(type: K): GGSchema<GGAuthzParentRef<ParentsOf<Service, Types[K]>>>
    readonly actions: readonly GGAuthzDefinedAction[]
    readonly definedAt?: string
} & {readonly [K in keyof Actions & string]: GGAuthzDefinedAction<`${Service}:${K}`, TypeName<Service, Actions[K]["on"][number]>, TypeName<Service, Actions[K]["on"][number]> | ParentsOf<Service, Types[Actions[K]["on"][number] & keyof Types]>>}

export interface GGAuthzDefinedRole {
    readonly name: string
    readonly actions: readonly string[]
    readonly includes?: readonly string[]
    readonly description?: string
    readonly definedAt?: string
}

export interface GGAuthzRuleSpec {
    actions: readonly GGAuthzActionRef[]
    resources?: readonly string[]
    when?: readonly string[]
    unless?: readonly string[]
    conditions?: readonly GGAuthzCondition[]
}

export interface GGAuthzDefinedTokenScope {
    readonly name: string
    readonly allow: readonly GGAuthzRule[]
    readonly description?: string
    readonly definedAt?: string
}

export interface GGAuthzModelSpec {
    partition: string
    services: readonly GGAuthzService[]
    roles: readonly GGAuthzDefinedRole[]
    tokenScopes?: readonly GGAuthzDefinedTokenScope[]
    workloadTypes?: readonly string[]
    approvalFloor?: readonly {actions: readonly GGAuthzActionRef[], level: GGAuthzApprovalLevel}[]
    stepUpFacts?: readonly string[]
    grantAction?: GGAuthzActionRef
}

type Kind = "service" | "role" | "token scope"

const registry = new Map<string, string | undefined>()
export const validatedModels = new WeakSet<GGAuthzModel>()

export function defineAuthzService<const Service extends string, const Types extends Record<string, GGAuthzTypeSpec> = {}, const Actions extends Record<string, GGAuthzActionSpec<NoInfer<keyof Types & string>>> = {}>(
    name: Service,
    spec: GGAuthzServiceSpec<Types, Actions>,
): GGAuthzService<Service, Types, Actions> {
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
    return register("service", name, deepFreeze(service)) as GGAuthzService<Service, Types, Actions>
}

export function defineAuthzRole(name: string, spec: {actions?: readonly GGAuthzActionRef[], includes?: readonly (string | GGAuthzDefinedRole)[], description?: string}): GGAuthzDefinedRole {
    const includes = spec.includes?.map(r => typeof r === "string" ? r : r.name)
    return register("role", name, deepFreeze({name, actions: (spec.actions ?? []).map(actionName), includes, description: spec.description, definedAt: definedAt()}))
}

export function defineAuthzTokenScope(name: string, spec: {allow: readonly GGAuthzRuleSpec[], description?: string}): GGAuthzDefinedTokenScope {
    const allow = spec.allow.map(r => ({...r, actions: r.actions.map(actionName)}) as GGAuthzRule)
    return register("token scope", name, deepFreeze({name, allow, description: spec.description, definedAt: definedAt()}))
}

export function defineAuthzModel(spec: GGAuthzModelSpec): GGAuthzModel {
    const model = IsGGAuthzModel.parse({
        partition: spec.partition,
        actions: spec.services.flatMap(s => s.actions.map(a => ({name: a.name, resourceTypes: [...a.resourceTypes], description: a.description}))),
        roles: spec.roles.map(r => ({name: r.name, actions: [...r.actions], includes: r.includes && [...r.includes], description: r.description})),
        tokenScopes: spec.tokenScopes?.map(s => ({name: s.name, allow: s.allow, description: s.description})),
        workloadTypes: spec.workloadTypes && [...spec.workloadTypes],
        approvalFloor: spec.approvalFloor?.map(f => ({actions: f.actions.map(actionName), level: f.level})),
        stepUpFacts: spec.stepUpFacts && [...spec.stepUpFacts],
        grantAction: spec.grantAction && actionName(spec.grantAction),
    })
    const types = new Set(spec.services.flatMap(s => s.resourceTypes.map(t => t.name)))
    const known = new Map<string, unknown>()
    for (const a of model.actions) {
        if (known.has(a.name)) throw new Error(`Duplicate action ${a.name}`)
        for (const t of a.resourceTypes) if (!types.has(t)) throw new Error(`Action ${a.name} is on ${t}, which no service in the model declares`)
        known.set(a.name, a)
    }
    expandRoles(known, model.roles)
    for (const s of model.tokenScopes ?? []) for (const r of s.allow) expandActions(known, r.actions)
    for (const f of model.approvalFloor ?? []) expandActions(known, f.actions)
    if (model.grantAction) expandActions(known, [model.grantAction])
    assertWorkloadTypes(model)
    deepFreeze(model)
    validatedModels.add(model)
    return model
}

export function definedAtOf(kind: Kind, name: string): string | undefined {
    return registry.get(`${kind}:${name}`)
}

export function actionName(ref: GGAuthzActionRef): string {
    return typeof ref === "string" ? ref : ref.name
}

// Same name from the same place is a module re-evaluation (HMR, vitest projects), not a duplicate. Compared without the
// query an HMR reload adds (`?t=…`); an edit above the definition before a reload still reads as a duplicate.
function register<T extends {definedAt?: string}>(kind: Kind, name: string, value: T): T {
    const key = `${kind}:${name}`
    if (registry.has(key) && placeOf(registry.get(key)) !== placeOf(value.definedAt)) {
        throw new Error(`Duplicate authz ${kind} ${name}: defined at ${registry.get(key) ?? "?"} and ${value.definedAt ?? "?"}`)
    }
    registry.set(key, value.definedAt)
    return value
}

function placeOf(at: string | undefined): string | undefined {
    return at?.replace(/\?[^:]*(?=:\d+:\d+$)/, "")
}

const SELF = import.meta.url.replace(/^file:\/\//, "").replace(/\/[^/]*$/, "/")

function definedAt(): string | undefined {
    const frame = new Error().stack?.split("\n").slice(1).find(line => !line.includes(SELF))
    return frame?.trim().replace(/^at\s+/, "").replace(/^.*\((.*)\)$/, "$1")
}

/** Approval levels apply only to workload principals; a floor on a model that names none would silently do nothing. */
export function assertWorkloadTypes(model: GGAuthzModel): void {
    if (model.approvalFloor?.length && !model.workloadTypes?.length) throw new Error("model.approvalFloor applies only to model.workloadTypes, and the model names none")
}
