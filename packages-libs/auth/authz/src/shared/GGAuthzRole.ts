import {deepFreeze} from "@grest-ts/common"
import type {IsGGAuthzRole} from "./authzSchemas"
import {actionName, definedAt, type GGAuthzActionRef, register} from "./definitions"

type RoleData = typeof IsGGAuthzRole.infer

/** A role: a model's, from `define`, or a tenant's, from its policies. */
export interface GGAuthzRole extends RoleData {
    readonly definedAt?: string
}

/** A role is plain data, as the model and policies hold it; the class holds only `define`. */
export abstract class GGAuthzRole {
    static define(name: string, spec: {actions?: readonly GGAuthzActionRef[], includes?: readonly (string | GGAuthzRole)[], description?: string}): GGAuthzRole {
        const includes = spec.includes?.map(r => typeof r === "string" ? r : r.name)
        return register("role", name, deepFreeze({name, actions: (spec.actions ?? []).map(actionName), includes, description: spec.description, definedAt: definedAt()}))
    }
}
