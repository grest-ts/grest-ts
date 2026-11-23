import {deepFreeze} from "@grest-ts/common"
import type {GGAuthzCondition, GGAuthzRule, IsGGAuthzTokenScope} from "./authzSchemas"
import {actionName, definedAt, type GGAuthzActionRef, register} from "./definitions"

export interface GGAuthzRuleSpec {
    actions: readonly GGAuthzActionRef[]
    resources?: readonly string[]
    when?: readonly string[]
    unless?: readonly string[]
    conditions?: readonly GGAuthzCondition[]
    ref?: string
}

type TokenScopeData = typeof IsGGAuthzTokenScope.infer

export interface GGAuthzTokenScope extends TokenScopeData {
    readonly definedAt?: string
}

/** A token scope is plain data, as the model holds it; the class holds only `define`. */
export abstract class GGAuthzTokenScope {
    static define(name: string, spec: {allow: readonly GGAuthzRuleSpec[], description?: string}): GGAuthzTokenScope {
        const allow = spec.allow.map(r => ({...r, actions: r.actions.map(actionName)}) as GGAuthzRule)
        return register("token scope", name, deepFreeze({name, allow, description: spec.description, definedAt: definedAt()}))
    }
}
