import {deepFreeze} from "@grest-ts/common"
import {expandActions, expandRoles} from "./chain"
import {actionBuilders, type GGAuthzActionBuilders} from "./requirement"
import {type GGAuthzApprovalLevel, type GGAuthzCondition, type GGAuthzModel, type GGAuthzRule, IsGGAuthzActionName, IsGGAuthzModel, IsGGAuthzResourceType} from "./authzSchemas"

export type GGAuthzActionRef = string | {readonly name: string}

export interface GGAuthzDefinedAction<Name extends string = string, Types extends string = string> extends GGAuthzActionBuilders<Types> {
    readonly name: Name
    readonly resourceTypes: readonly Types[]
    readonly description?: string
}

/** `on`: the service's own types, or another service's as `service:type` (e.g. a create checked on its parent). */
export interface GGAuthzActionSpec<Type extends string> {
    on: readonly (Type | `${string}:${string}`)[]
    description?: string
}

export interface GGAuthzServiceSpec<Type extends string, Actions extends Record<string, GGAuthzActionSpec<Type>>> {
    description?: string
    /** Resource type → description. */
    types?: Record<Type, string>
    actions: Actions
}

type TypeName<Service extends string, T> = T extends `${string}:${string}` ? T : T extends string ? `${Service}:${T}` : never

export type GGAuthzService<Service extends string = string, Type extends string = string, Actions extends Record<string, GGAuthzActionSpec<string>> = {}> = {
    readonly name: Service
    readonly all: `${Service}:*`
    readonly description?: string
    readonly types: {readonly [K in Type]: `${Service}:${K}`}
    readonly resourceTypes: readonly {readonly name: string, readonly description: string}[]
    readonly actions: readonly GGAuthzDefinedAction[]
    readonly definedAt?: string
} & {readonly [K in keyof Actions & string]: GGAuthzDefinedAction<`${Service}:${K}`, TypeName<Service, Actions[K]["on"][number]>>}

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

export function defineAuthzService<const Service extends string, Type extends string = never, const Actions extends Record<string, GGAuthzActionSpec<NoInfer<Type>>> = {}>(
    name: Service,
    spec: GGAuthzServiceSpec<Type, Actions>,
): GGAuthzService<Service, Type, Actions> {
    const types: Record<string, string> = {}
    const resourceTypes = Object.entries<string>(spec.types ?? {}).map(([type, description]) => {
        types[type] = IsGGAuthzResourceType.parse(`${name}:${type}`)
        return {name: types[type]!, description}
    })
    const actions: GGAuthzDefinedAction[] = []
    const service: Record<string, unknown> = {name, all: `${name}:*`, description: spec.description, types, resourceTypes, actions, definedAt: definedAt()}
    for (const [key, action] of Object.entries<GGAuthzActionSpec<string>>(spec.actions)) {
        if (!/^[A-Z]/.test(key)) throw new Error(`Action ${name}:${key} must start with an upper-case letter`)
        const resource = action.on.map(type => {
            if (type.includes(":")) return IsGGAuthzResourceType.parse(type)
            if (!(type in types)) throw new Error(`Action ${name}:${key} is on unknown type ${type}`)
            return types[type]!
        })
        const actionName = IsGGAuthzActionName.parse(`${name}:${key}`)
        const defined = Object.defineProperties({name: actionName, resourceTypes: resource, description: action.description}, actionBuilders(actionName, resource)) as unknown as GGAuthzDefinedAction
        actions.push(defined)
        service[key] = defined
    }
    return register("service", name, deepFreeze(service)) as GGAuthzService<Service, Type, Actions>
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

function actionName(ref: GGAuthzActionRef): string {
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
