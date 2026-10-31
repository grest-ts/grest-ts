import {GGIssueKey, IsArray, IsBoolean, IsLiteral, IsNumber, IsObject, IsRecord, IsString, IsUnion, IsUnknown} from "@grest-ts/schema"
import {GGAuthzRn} from "./GGAuthzRn"

export const IsGGAuthzRn = IsString.regex(GGAuthzRn.REGEX).docs({
    title: "Resource name",
    description: "rn:<partition>:<service>:<tenant>:<type>/<id>[/<subtype>/<id>...]",
    example: "rn:acme:vm:acme:workspace/w1",
})
export const IsGGAuthzRnMatcher = IsString.refine(
    v => GGAuthzRn.REGEX.test(GGAuthzRn.isExact(v) ? v.slice(1) : v) || GGAuthzRn.isValidPattern(v),
    new GGIssueKey("rnMatcher", "Must be a resource name, `=` and a resource name, or a prefix pattern ending in `/*` or `:*`"),
).docs({
    title: "Resource matcher",
    description: "An RN (the resource and everything under it in the scope tree), `=rn:…` (that resource only) or a prefix pattern ending in `/*` or `:*`",
    example: "rn:acme:secrets:acme:secret/*",
})
export const IsGGAuthzResourceType = IsString.regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/).docs({title: "Resource type", example: "vm:workspace"})
export const IsGGAuthzActionName = IsString.regex(/^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9]*$/).docs({title: "Action", example: "vm:StopWorkspace"})
export const IsGGAuthzActionPattern = IsString.regex(/^[a-z][a-z0-9-]*:(?:\*|[A-Za-z][A-Za-z0-9]*)$/).docs({title: "Action or `service:*`", example: "vm:*"})
export const IsGGAuthzPrincipalSelector = IsString.regex(/^(?:everyone|[a-z][a-z0-9-]*:(?:\*|[A-Za-z0-9._@+=,~-]+))$/).docs({
    title: "Principal selector",
    description: "`<type>:<id>`, `<type>:*` (every principal of that type) or `everyone`",
    example: "group:eng",
})
export const IsGGAuthzFactName = IsString.regex(/^[A-Za-z][A-Za-z0-9_]*$/).docs({title: "Fact name", example: "mfa"})
export const GG_AUTHZ_APPROVAL_LEVELS = ["auto", "ask-once", "ask", "critical", "dangerous", "humans-only"] as const
export const IsGGAuthzApprovalLevel = IsLiteral(...GG_AUTHZ_APPROVAL_LEVELS).docs({
    title: "Approval level",
    description: "Ordered from least to most strict; `humans-only` denies workload principals",
})
export type GGAuthzApprovalLevel = typeof IsGGAuthzApprovalLevel.infer

const IsWhen = IsArray(IsGGAuthzFactName).orUndefined.docs({description: "Every fact must be true"})
const IsUnless = IsArray(IsGGAuthzFactName).orUndefined.docs({description: "Every fact must be false"})

export const IsGGAuthzConditionKey = IsString.regex(/^(principal|actor|resource|context)\.[A-Za-z][A-Za-z0-9_]*$/).docs({
    title: "Attribute",
    description: "`principal.*` (whose permissions: the human when acting on behalf), `actor.*` (the acting principal), `resource.*` or `context.*`. Built in: `principal.key`, `actor.key`, `resource.rn`",
    example: "resource.env",
})
export const GG_AUTHZ_CONDITION_OPS = ["eq", "ne", "in", "notIn", "lt", "le", "gt", "ge", "startsWith", "contains", "present"] as const
const IsScalar = IsUnion(IsString, IsNumber, IsBoolean)

export const IsGGAuthzCondition = IsObject({
    key: IsGGAuthzConditionKey,
    op: IsLiteral(...GG_AUTHZ_CONDITION_OPS).docs({description: "`in`/`notIn` take an array, `lt`…`ge` numbers, `startsWith` a string, `contains` an array attribute, `present` true/false"}),
    value: IsUnion(IsScalar, IsArray(IsScalar)).orUndefined,
    ref: IsGGAuthzConditionKey.orUndefined.docs({description: "Compare with another attribute instead of `value`"}),
}).refine(
    c => c.op === "present" ? typeof c.value === "boolean" && c.ref === undefined
        : (c.value === undefined) !== (c.ref === undefined) && (c.ref !== undefined || (c.op === "in" || c.op === "notIn") === Array.isArray(c.value)),
    new GGIssueKey("authzCondition", "Needs exactly one of `value` and `ref`; `in`/`notIn` take an array, `present` takes true or false"),
)
export type GGAuthzCondition = typeof IsGGAuthzCondition.infer
const IsConditions = IsArray(IsGGAuthzCondition).orUndefined.docs({description: "Every condition must hold; a missing attribute is unknown"})
const IsContext = IsRecord(IsString, IsUnknown).orUndefined

export const IsGGAuthzAction = IsObject({
    name: IsGGAuthzActionName,
    resourceTypes: IsArray(IsGGAuthzResourceType),
    description: IsString.orUndefined,
})
export type GGAuthzAction = typeof IsGGAuthzAction.infer

export const IsGGAuthzRole = IsObject({
    name: IsString.nonEmpty,
    actions: IsArray(IsGGAuthzActionPattern).orUndefined,
    includes: IsArray(IsString.nonEmpty).orUndefined.docs({description: "Roles whose actions this role also has"}),
    description: IsString.orUndefined,
})
export type GGAuthzRole = typeof IsGGAuthzRole.infer

const IsActions = IsArray(IsGGAuthzActionPattern)
const IsResources = IsArray(IsGGAuthzRnMatcher).orUndefined.docs({description: "Any must match; omitted = any resource"})

export const IsGGAuthzRule = IsObject({
    actions: IsActions,
    resources: IsResources,
    when: IsWhen,
    unless: IsUnless,
    conditions: IsConditions,
    approval: IsLiteral("auto", "ask-once", "ask", "critical", "dangerous").orUndefined.docs({
        description: "In a ceiling: the approval level a workload passing through this rule needs. A ceiling takes its least strict matching rule; the strictest ceiling counts. Leave an action out to deny it",
    }),
})
export type GGAuthzRule = typeof IsGGAuthzRule.infer

export const IsGGAuthzApprovalRule = IsObject({
    actions: IsArray(IsGGAuthzActionPattern),
    level: IsGGAuthzApprovalLevel,
    locked: IsBoolean.orUndefined.docs({description: "Descendants may raise but not lower this level"}),
})
export type GGAuthzApprovalRule = typeof IsGGAuthzApprovalRule.infer

export const IsGGAuthzTokenScope = IsObject({
    name: IsString.nonEmpty,
    allow: IsArray(IsGGAuthzRule),
    description: IsString.orUndefined,
})
export type GGAuthzTokenScope = typeof IsGGAuthzTokenScope.infer

export const IsGGAuthzModel = IsObject({
    partition: IsString.regex(/^[a-z][a-z0-9-]*$/),
    actions: IsArray(IsGGAuthzAction),
    roles: IsArray(IsGGAuthzRole),
    tokenScopes: IsArray(IsGGAuthzTokenScope).orUndefined,
    workloadTypes: IsArray(IsString).orUndefined.docs({description: "Principal types that approvals apply to, e.g. `agent`; none by default"}),
    approvalFloor: IsArray(IsGGAuthzApprovalRule).orUndefined.docs({description: "Platform minimum approval levels, always locked"}),
    stepUpFacts: IsArray(IsGGAuthzFactName).orUndefined.docs({description: "Facts a caller can make true by re-authenticating, e.g. `mfa` from the token's `acr`/`amr`"}),
    grantAction: IsGGAuthzActionName.orUndefined.docs({description: "Needed on a scope to create bindings there (`canGrant`)"}),
})
export type GGAuthzModel = typeof IsGGAuthzModel.infer

export const IsGGAuthzBinding = IsObject({
    principal: IsGGAuthzPrincipalSelector,
    role: IsString.nonEmpty,
    on: IsGGAuthzRn,
    when: IsWhen,
    unless: IsUnless,
    conditions: IsConditions,
})
export type GGAuthzBinding = typeof IsGGAuthzBinding.infer

export const IsGGAuthzStatement = IsObject({
    sid: IsString.orUndefined,
    effect: IsLiteral("allow", "deny"),
    principals: IsArray(IsGGAuthzPrincipalSelector),
    except: IsArray(IsGGAuthzPrincipalSelector).orUndefined,
}).merge(IsGGAuthzRule)
export type GGAuthzStatement = typeof IsGGAuthzStatement.infer

export const IsGGAuthzResourcePolicy = IsObject({
    on: IsGGAuthzRn,
    statements: IsArray(IsGGAuthzStatement).orUndefined,
    approvals: IsArray(IsGGAuthzApprovalRule).orUndefined,
})
export type GGAuthzResourcePolicy = typeof IsGGAuthzResourcePolicy.infer

export const IsGGAuthzBoundary = IsObject({
    id: IsString.nonEmpty,
    principals: IsArray(IsGGAuthzPrincipalSelector),
    allow: IsArray(IsGGAuthzRule),
})
export type GGAuthzBoundary = typeof IsGGAuthzBoundary.infer

export const IsGGAuthzGuardrail = IsObject({
    id: IsString.nonEmpty,
    on: IsGGAuthzRn,
    principals: IsArray(IsGGAuthzPrincipalSelector).orUndefined.docs({description: "Default: everyone"}),
    except: IsArray(IsGGAuthzPrincipalSelector).orUndefined,
    deny: IsArray(IsGGAuthzRule).orUndefined,
    ceiling: IsArray(IsGGAuthzRule).orUndefined.docs({description: "When set, nothing outside these rules is possible under `on`"}),
})
export type GGAuthzGuardrail = typeof IsGGAuthzGuardrail.infer

export const IsGGAuthzPolicies = IsObject({
    roles: IsArray(IsGGAuthzRole).orUndefined.docs({description: "Tenant-defined roles, next to the model's"}),
    bindings: IsArray(IsGGAuthzBinding).orUndefined,
    resourcePolicies: IsArray(IsGGAuthzResourcePolicy).orUndefined,
    boundaries: IsArray(IsGGAuthzBoundary).orUndefined,
    guardrails: IsArray(IsGGAuthzGuardrail).orUndefined,
})
export type GGAuthzPolicies = typeof IsGGAuthzPolicies.infer

export const IsGGAuthzEntity = IsObject({
    type: IsString.nonEmpty,
    id: IsString.nonEmpty,
})
export type GGAuthzEntity = typeof IsGGAuthzEntity.infer

export const IsGGAuthzSubject = IsObject({
    type: IsString.nonEmpty,
    id: IsString.nonEmpty,
    properties: IsObject({
        onBehalfOf: IsGGAuthzEntity.orUndefined.docs({description: "The human a workload acts for: allows come from them, the acting principal's boundaries still apply"}),
        scopes: IsArray(IsString).orUndefined.docs({description: "Token scopes: a ceiling, like a boundary"}),
        via: IsArray(IsGGAuthzEntity).orUndefined.docs({description: "Further acting principals between the authority and this one (a delegation chain): each one's boundaries apply, each must clear denies"}),
        restrictions: IsArray(IsGGAuthzRule).orUndefined.docs({description: "A per-request ceiling, e.g. from the token's authorization details: nothing outside these rules"}),
        attributes: IsRecord(IsString, IsUnknown).orUndefined.docs({description: "The acting principal's attributes (`actor.*`), as the caller knows them for this request; the resolver isn't asked"}),
    }).orUndefined,
})
export type GGAuthzSubject = typeof IsGGAuthzSubject.infer

export const IsGGAuthzResourceProperties = IsObject({
    ancestors: IsArray(IsGGAuthzRn).orUndefined.docs({description: "The resource's ancestors, nearest first, from the row the caller already loaded; the resolver isn't asked"}),
    attributes: IsRecord(IsString, IsUnknown).orUndefined.docs({description: "The resource's attributes, likewise"}),
})
export type GGAuthzResourceProperties = typeof IsGGAuthzResourceProperties.infer

export const IsGGAuthzRequest = IsObject({
    subject: IsGGAuthzSubject,
    action: IsObject({name: IsGGAuthzActionName}),
    resource: IsObject({
        type: IsGGAuthzResourceType,
        id: IsString.nonEmpty,
        properties: IsGGAuthzResourceProperties.orUndefined,
    }),
    context: IsContext,
})
export type GGAuthzRequest = typeof IsGGAuthzRequest.infer

export const IsGGAuthzReason = IsObject({
    layer: IsLiteral("request", "guardrail", "deny", "boundary", "scope", "restriction", "allow", "approval", "default", "grant"),
    kind: IsLiteral("invalid", "denied", "ceiling-failed", "ceiling-passed", "binding", "statement", "approval", "no-grant", "escalation"),
    message: IsString.orUndefined,
    id: IsString.orUndefined.docs({description: "Guardrail / boundary id, token scope name or statement sid"}),
    on: IsString.orUndefined.docs({description: "Where the deciding binding / policy / guardrail is attached"}),
    principal: IsString.orUndefined,
    role: IsString.orUndefined,
    actions: IsArray(IsString).orUndefined.docs({description: "The matching rule's actions"}),
    level: IsGGAuthzApprovalLevel.orUndefined,
    locked: IsBoolean.orUndefined.docs({description: "The resolved level is a locked minimum: nothing below may lower it"}),
    lowered: IsObject({on: IsString, level: IsGGAuthzApprovalLevel}).orUndefined.docs({description: "A descendant's attempt to go below a locked minimum, ignored"}),
})
export type GGAuthzReason = typeof IsGGAuthzReason.infer

export const IsGGAuthzOutcome = IsLiteral("allow", "allow-with-approval", "deny")
export type GGAuthzOutcome = typeof IsGGAuthzOutcome.infer

export const IsGGAuthzRemedy = IsObject({
    scopes: IsArray(IsString).orUndefined.docs({description: "Denied by the token scopes only: any of these scopes would allow it"}),
    stepUp: IsArray(IsGGAuthzFactName).orUndefined.docs({description: "Allowed once these step-up facts are true"}),
})
export type GGAuthzRemedy = typeof IsGGAuthzRemedy.infer

export const IsGGAuthzDecision = IsObject({
    decision: IsBoolean,
    context: IsObject({
        outcome: IsGGAuthzOutcome,
        approval: IsGGAuthzApprovalLevel.orUndefined,
        audit: IsBoolean.orUndefined.docs({description: "Set for workload principals, also at `auto`"}),
        reasons: IsArray(IsGGAuthzReason),
        remedy: IsGGAuthzRemedy.orUndefined.docs({description: "On a deny: what would make the same request allowed"}),
    }),
})
export type GGAuthzDecision = typeof IsGGAuthzDecision.infer

export const IsGGAuthzGrantRequest = IsObject({
    subject: IsGGAuthzSubject,
    binding: IsGGAuthzBinding,
    context: IsContext,
})
export type GGAuthzGrantRequest = typeof IsGGAuthzGrantRequest.infer

const IsGGAuthzEvaluation = IsObject({
    subject: IsGGAuthzSubject.orUndefined,
    action: IsObject({name: IsGGAuthzActionName}).orUndefined,
    resource: IsObject({type: IsGGAuthzResourceType, id: IsString.nonEmpty}).orUndefined,
    context: IsContext,
})

export const IsGGAuthzEvaluationsRequest = IsGGAuthzEvaluation.extend({evaluations: IsArray(IsGGAuthzEvaluation)})
export type GGAuthzEvaluationsRequest = typeof IsGGAuthzEvaluationsRequest.infer

export const IsGGAuthzEvaluationsResponse = IsObject({
    evaluations: IsArray(IsGGAuthzDecision),
})
export type GGAuthzEvaluationsResponse = typeof IsGGAuthzEvaluationsResponse.infer

export const IsGGAuthzListRequest = IsObject({
    subject: IsGGAuthzSubject,
    action: IsObject({name: IsGGAuthzActionName}),
    resource: IsObject({type: IsGGAuthzResourceType}),
    context: IsContext.docs({description: "Request context for `context.*` conditions; facts stay row residuals"}),
})
export type GGAuthzListRequest = typeof IsGGAuthzListRequest.infer

export const IsGGAuthzPlanFilter = IsObject({
    within: IsGGAuthzRn.orUndefined.docs({description: "The row is this resource or a descendant of it"}),
    exceptWithin: IsArray(IsGGAuthzRn).orUndefined.docs({description: "...but not inside any of these"}),
    resources: IsArray(IsGGAuthzRnMatcher).orUndefined.docs({description: "Any must match"}),
    when: IsWhen,
    unless: IsUnless,
    conditions: IsArray(IsGGAuthzCondition).orUndefined.docs({description: "On `resource.*` only; principal and context values are already substituted"}),
})
export type GGAuthzPlanFilter = typeof IsGGAuthzPlanFilter.infer

export const IsGGAuthzPlan = IsObject({
    action: IsString,
    resourceType: IsString,
    include: IsArray(IsGGAuthzPlanFilter).docs({description: "A row must match at least one; empty = nothing is allowed"}),
    exclude: IsArray(IsGGAuthzPlanFilter).docs({description: "A row must match none; a filter whose facts are unknown for the row matches"}),
    require: IsArray(IsObject({
        id: IsString,
        within: IsGGAuthzRn.orUndefined.docs({description: "Only rows inside this scope must satisfy the ceiling"}),
        anyOf: IsArray(IsGGAuthzPlanFilter),
    })).docs({description: "Ceilings: a row must match at least one filter of each"}),
    values: IsRecord(IsString, IsUnknown).orUndefined.docs({description: "Principal, actor and context values the residual conditions reference, by key"}),
})
export type GGAuthzPlan = typeof IsGGAuthzPlan.infer
