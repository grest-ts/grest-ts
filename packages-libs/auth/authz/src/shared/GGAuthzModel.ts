import {deepFreeze} from "@grest-ts/common"
import {type GGContractClass, type GGContractMethod, GGPermissionChecker} from "@grest-ts/schema"
import {GG_AUTHZ_APPROVAL_LEVELS, type GGAuthzApprovalLevel, IsGGAuthzModel} from "./authzSchemas"
import {expandActions, expandRoles} from "./chain"
import {actionName, definedAtOf, type GGAuthzActionRef} from "./definitions"
import type {GGAuthzRole} from "./GGAuthzRole"
import type {GGAuthzService} from "./GGAuthzService"
import type {GGAuthzRuleSpec, GGAuthzTokenScope} from "./GGAuthzTokenScope"

export interface GGAuthzModelSpec {
    partition: string
    services: readonly GGAuthzService[]
    roles: readonly GGAuthzRole[]
    tokenScopes?: readonly GGAuthzTokenScope[]
    workloadTypes?: readonly string[]
    approvalFloor?: readonly (Omit<GGAuthzRuleSpec, "resources" | "ref"> & {level: GGAuthzApprovalLevel})[]
    stepUpFacts?: readonly string[]
    grantAction?: GGAuthzActionRef
}

export interface GGAuthzDescribeOptions {
    contracts?: readonly GGContractClass<any>[]
}

export interface GGAuthzActionInfo {
    readonly name: string
    readonly description?: string
    readonly resourceTypes: readonly string[]
    readonly roles: readonly string[]
    readonly tokenScopes: readonly string[]
    readonly approvalFloor?: GGAuthzApprovalLevel
    /** `Contract.method` entries declaring this action. */
    readonly methods: readonly string[]
    readonly definedAt?: string
}

export interface GGAuthzRoleInfo {
    readonly name: string
    readonly description?: string
    readonly actions: readonly string[]
    readonly definedAt?: string
}

export interface GGAuthzCatalog {
    readonly actions: readonly GGAuthzActionInfo[]
    readonly roles: readonly GGAuthzRoleInfo[]
    readonly tokenScopes: readonly GGAuthzRoleInfo[]
}

type ModelData = typeof IsGGAuthzModel.infer

export interface GGAuthzModel extends ModelData {}

export const validatedModels = new WeakSet<GGAuthzModel>()

/** A model is plain, frozen data that `IsGGAuthzModel` accepts, so the engine also takes one parsed from JSON; the class
 *  holds only functions on it. */
export abstract class GGAuthzModel {
    static define(spec: GGAuthzModelSpec): GGAuthzModel {
        const model = IsGGAuthzModel.parse({
            partition: spec.partition,
            actions: spec.services.flatMap(s => s.actions.map(a => ({name: a.name, resourceTypes: [...a.resourceTypes], description: a.description}))),
            roles: spec.roles.map(r => ({name: r.name, actions: r.actions?.slice(), includes: r.includes?.slice(), description: r.description})),
            tokenScopes: spec.tokenScopes?.map(s => ({name: s.name, allow: s.allow, description: s.description})),
            workloadTypes: spec.workloadTypes && [...spec.workloadTypes],
            approvalFloor: spec.approvalFloor?.map(f => ({...f, actions: f.actions.map(actionName)})),
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

    /** A catalog of actions and roles for UIs and agents; `contracts` adds the methods declaring each action. */
    static describe(model: GGAuthzModel, options?: GGAuthzDescribeOptions): GGAuthzCatalog {
        const known = new Map(model.actions.map(a => [a.name, a]))
        const expanded = expandRoles(known, model.roles)
        const roles = model.roles.map(r => ({
            name: r.name,
            description: r.description,
            actions: [...expanded.get(r.name)!],
            definedAt: definedAtOf("role", r.name),
        }))
        const tokenScopes = (model.tokenScopes ?? []).map(s => ({
            name: s.name,
            description: s.description,
            actions: [...new Set(s.allow.flatMap(r => [...expandActions(known, r.actions)]))],
            definedAt: definedAtOf("token scope", s.name),
        }))
        const floors = (model.approvalFloor ?? []).map(f => ({actions: expandActions(known, f.actions), level: GG_AUTHZ_APPROVAL_LEVELS.indexOf(f.level)}))
        const methods = new Map<string, string[]>()
        for (const contract of options?.contracts ?? []) {
            for (const [name, method] of Object.entries<GGContractMethod>(contract.methods)) {
                const actions = GGPermissionChecker.requirementsOf(method.permission).map(r => r.action)
                for (const action of new Set(actions)) {
                    if (!known.has(action)) throw new Error(`${contract.name}.${name} declares unknown action ${action}`)
                    methods.set(action, [...methods.get(action) ?? [], `${contract.name}.${name}`])
                }
            }
        }
        return {
            actions: model.actions.map(a => {
                const floor = Math.max(-1, ...floors.filter(f => f.actions.has(a.name)).map(f => f.level))
                return {
                    name: a.name,
                    description: a.description,
                    resourceTypes: a.resourceTypes,
                    roles: roles.filter(r => r.actions.includes(a.name)).map(r => r.name),
                    tokenScopes: tokenScopes.filter(s => s.actions.includes(a.name)).map(s => s.name),
                    approvalFloor: floor < 0 ? undefined : GG_AUTHZ_APPROVAL_LEVELS[floor],
                    methods: methods.get(a.name) ?? [],
                    definedAt: definedAtOf("service", a.name.slice(0, a.name.indexOf(":"))),
                }
            }),
            roles,
            tokenScopes,
        }
    }

    /** The catalog as a Markdown reference. */
    static document(model: GGAuthzModel, options?: GGAuthzDescribeOptions): string {
        const catalog = GGAuthzModel.describe(model, options)
        const row = (cells: readonly string[]) => `| ${cells.map(c => c.replace(/\|/g, "\\|")).join(" | ")} |`
        const list = (items: readonly string[]) => items.map(i => `\`${i}\``).join(", ")
        return [
            "## Actions",
            "",
            row(["Action", "Resource types", "Description", "Roles", "Token scopes", "Approval floor", "Methods"]),
            row(["---", "---", "---", "---", "---", "---", "---"]),
            ...catalog.actions.map(a => row([`\`${a.name}\``, list(a.resourceTypes), a.description ?? "", a.roles.join(", "), a.tokenScopes.join(", "), a.approvalFloor ?? "", list(a.methods)])),
            "",
            "## Roles",
            "",
            row(["Role", "Description", "Actions"]),
            row(["---", "---", "---"]),
            ...catalog.roles.map(r => row([r.name, r.description ?? "", list(r.actions)])),
            ...catalog.tokenScopes.length ? [
                "",
                "## Token scopes",
                "",
                row(["Scope", "Description", "Actions"]),
                row(["---", "---", "---"]),
                ...catalog.tokenScopes.map(s => row([s.name, s.description ?? "", list(s.actions)])),
            ] : [],
            "",
        ].join("\n")
    }
}

/** Approval levels apply only to workload principals; a floor on a model that names none would silently do nothing. */
export function assertWorkloadTypes(model: GGAuthzModel): void {
    if (model.approvalFloor?.length && !model.workloadTypes?.length) throw new Error("model.approvalFloor applies only to model.workloadTypes, and the model names none")
}
