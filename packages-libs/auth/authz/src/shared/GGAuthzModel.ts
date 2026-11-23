import {deepFreeze} from "@grest-ts/common"
import {type GGAuthzApprovalLevel, IsGGAuthzModel} from "./authzSchemas"
import {expandActions, expandRoles} from "./chain"
import {actionName, type GGAuthzActionRef} from "./definitions"
import {describeModel, documentModel, type GGAuthzCatalog, type GGAuthzDescribeOptions} from "./describeAuthz"
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
        return describeModel(model, options)
    }

    /** The catalog as a Markdown reference. */
    static document(model: GGAuthzModel, options?: GGAuthzDescribeOptions): string {
        return documentModel(model, options)
    }
}

/** Approval levels apply only to workload principals; a floor on a model that names none would silently do nothing. */
export function assertWorkloadTypes(model: GGAuthzModel): void {
    if (model.approvalFloor?.length && !model.workloadTypes?.length) throw new Error("model.approvalFloor applies only to model.workloadTypes, and the model names none")
}
