import {FORBIDDEN, NOT_AUTHORIZED} from "@grest-ts/schema"
import {applyPlan} from "./applyPlan"
import {expandActions, expandRoles, MAX_DEPTH, type OnUnknownAction} from "../shared/chain"
import {type AttributeLookup, evalCondition, evalConditional, evalConditions, isResourceKey} from "./conditions"
import {type GGAuthzActionRef, validatedModels} from "../shared/defineAuthz"
import {APPROVAL_REQUIRED, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED} from "../shared/authzErrors"
import {explain} from "./explain"
import {GG_AUTHZ_SUBJECT} from "./GG_AUTHZ_SUBJECT"
import {GGAuthzRn} from "../shared/GGAuthzRn"
import {
    type GGAuthzApprovalLevel,
    GG_AUTHZ_APPROVAL_LEVELS,
    type GGAuthzBinding,
    type GGAuthzCondition,
    type GGAuthzDecision,
    type GGAuthzEntity,
    type GGAuthzEvaluationsRequest,
    type GGAuthzEvaluationsResponse,
    type GGAuthzGrantRequest,
    type GGAuthzListRequest,
    type GGAuthzModel,
    type GGAuthzPlan,
    type GGAuthzPlanFilter,
    type GGAuthzPolicies,
    type GGAuthzReason,
    type GGAuthzRemedy,
    type GGAuthzRequest,
    type GGAuthzResourceProperties,
    type GGAuthzRule,
    type GGAuthzSubject,
    IsGGAuthzModel,
    IsGGAuthzPolicies,
} from "../shared/authzSchemas"

type Awaitable<T> = T | Promise<T>
type Attributes = Readonly<Record<string, unknown>>

export interface GGAuthzResolver {
    /** Ancestors of `rn` in the scope tree, nearest first, without `rn` itself. */
    ancestors(rn: string): Awaitable<readonly string[]>
    /** Groups (`group:<id>`) the principal (`<type>:<id>`) is a member of, transitively. */
    groups(principal: string): Awaitable<readonly string[]>
    /** Attributes of a principal key or an RN, for `conditions`; only called when a policy uses them. */
    attributes?(entity: string): Awaitable<Attributes | undefined>
}

/** Caller-computed facts; `undefined` = unknown, which makes a deny apply and an allow not grant. */
export type GGAuthzFacts = (name: string, request: GGAuthzRequest) => boolean | undefined

/** Obtains approval for an `allow-with-approval` decision, or throws. */
export type GGAuthzApprovals = (request: GGAuthzRequest, decision: GGAuthzDecision) => Promise<void>

export interface GGAuthzConfig {
    model: GGAuthzModel
    policies: GGAuthzPolicies
    resolver: GGAuthzResolver
    facts?: GGAuthzFacts
    /** Without it, `authorize` throws APPROVAL_REQUIRED for decisions that need approval. */
    approvals?: GGAuthzApprovals
    /**
     * `ignore`: actions in `policies` the model doesn't know (e.g. from an uninstalled module) are skipped and listed in
     * `inactive`, instead of failing the build. Default `throw`.
     */
    unknownActions?: "throw" | "ignore"
}

export interface GGAuthzInactiveAction {
    /** `role <name>`, `policy <on> <sid>`, `approvals <on>`, `guardrail <id>` or `boundary <id>`. */
    readonly source: string
    readonly action: string
}

const HUMANS_ONLY = GG_AUTHZ_APPROVAL_LEVELS.length - 1

interface Matcher {
    prefix?: string
    within?: string
    exact?: string
}

interface Conditional {
    when?: string[]
    unless?: string[]
    conditions?: GGAuthzCondition[]
}

interface Rule extends Conditional {
    actions: Set<string>
    resources?: Matcher[]
    source: GGAuthzRule
}

interface Binding extends Conditional {
    principal: string
    role: string
    on: string
    actions: Set<string>
}

interface Statement extends Rule {
    sid: string
    effect: "allow" | "deny"
    principals: string[]
    except?: string[]
    on: string
}

interface Approval {
    actions: Set<string>
    level: number
    locked: boolean
}

interface Policy {
    on: string
    statements: Statement[]
    approvals: Approval[]
}

interface Boundary {
    id: string
    allow: Rule[]
}

interface Guardrail {
    id: string
    on: string
    principals: string[]
    except?: string[]
    deny: Rule[]
    ceiling?: Rule[]
}

interface Ceiling {
    layer: "guardrail" | "boundary" | "scope" | "restriction"
    id: string
    on?: string
    rules: Rule[]
    ids?: string[]
}

interface Identity {
    key: string
    type: string
    ids: Set<string>
}

interface Principals {
    actor: Identity
    /** The actor followed by the rest of the delegation chain. */
    actors: Identity[]
    authority: Identity
    anyIds: Set<string>
    workload: boolean
}

interface Roots {
    principal: boolean
    actor: boolean
    resource: boolean
}

interface Eval {
    request: GGAuthzRequest
    action: string
    rn: string
    chain: string[]
    chainSet: Set<string>
    p: Principals
    get: AttributeLookup
    facts: Map<string, boolean | undefined>
}

interface Loader {
    chain(rn: string): Promise<string[] | undefined>
    identity(entity: GGAuthzEntity): Promise<Identity>
    attributes(entity: string): Promise<Attributes | undefined>
}

export class GGAuthz {

    public static readonly explain = explain
    public static readonly applyPlan = applyPlan

    private readonly model: GGAuthzModel
    private readonly resolver: GGAuthzResolver
    private readonly facts: GGAuthzFacts
    private readonly approvals?: GGAuthzApprovals
    private readonly stepUpFacts: readonly string[]
    private readonly actions = new Map<string, Set<string>>()
    private readonly roles: Map<string, Set<string>>
    private readonly workloadTypes: Set<string>
    private readonly approvalFloor: Approval[]
    private readonly tokenScopes = new Map<string, Rule[]>()
    private readonly bindingsByScope = new Map<string, Binding[]>()
    private readonly bindingsByPrincipal = new Map<string, Binding[]>()
    private readonly policies = new Map<string, Policy>()
    private readonly statementsByPrincipal = new Map<string, Statement[]>()
    private readonly guardrails: Guardrail[] = []
    private readonly guardrailsByScope = new Map<string, Guardrail[]>()
    private readonly boundariesByPrincipal = new Map<string, Boundary[]>()
    private readonly roots: Roots = {principal: false, actor: false, resource: false}
    public readonly inactive: GGAuthzInactiveAction[] = []

    constructor(config: GGAuthzConfig) {
        this.model = validatedModels.has(config.model) ? config.model : IsGGAuthzModel.parse(config.model)
        const policies = IsGGAuthzPolicies.parse(config.policies)
        this.resolver = config.resolver
        this.approvals = config.approvals
        this.stepUpFacts = this.model.stepUpFacts ?? []
        this.facts = config.facts ?? ((name, request) => {
            const value = request.context?.[name]
            return typeof value === "boolean" ? value : undefined
        })
        this.workloadTypes = new Set(this.model.workloadTypes)

        for (const a of this.model.actions) {
            if (this.actions.has(a.name)) throw new Error(`Duplicate action ${a.name}`)
            this.actions.set(a.name, new Set(a.resourceTypes))
        }
        const modelRoles = new Set(this.model.roles.map(r => r.name))
        for (const r of policies.roles ?? []) if (modelRoles.has(r.name)) throw new Error(`Role ${r.name} is already defined by the model`)
        const tenantRoles = new Set((policies.roles ?? []).map(r => r.name))
        const lenient = (source: string) => config.unknownActions === "ignore" ? (action: string) => !!this.inactive.push({source, action}) : undefined
        this.roles = expandRoles(this.actions, [...this.model.roles, ...policies.roles ?? []], role => tenantRoles.has(role) ? lenient(`role ${role}`) : undefined)
        for (const s of this.model.tokenScopes ?? []) this.tokenScopes.set(s.name, s.allow.map(r => this.rule(r)))
        this.approvalFloor = (this.model.approvalFloor ?? []).map(a => ({...this.approval(a), locked: true}))
        if (this.model.grantAction && !this.actions.has(this.model.grantAction)) throw new Error(`Unknown action ${this.model.grantAction}`)

        for (const b of policies.bindings ?? []) {
            const actions = this.roles.get(b.role)
            if (!actions) throw new Error(`Unknown role ${b.role}`)
            const binding: Binding = {principal: b.principal, role: b.role, on: b.on, actions, when: b.when, unless: b.unless, conditions: b.conditions}
            mark(this.roots, b.conditions)
            push(this.bindingsByScope, b.on, binding)
            push(this.bindingsByPrincipal, b.principal, binding)
        }
        for (const p of policies.resourcePolicies ?? []) {
            const policy = this.policies.get(p.on) ?? {on: p.on, statements: [], approvals: []}
            this.policies.set(p.on, policy)
            for (const s of p.statements ?? []) {
                const sid = s.sid ?? `${p.on}#${policy.statements.length}`
                const statement: Statement = {
                    ...this.rule(s, lenient(`policy ${p.on} ${sid}`)),
                    sid,
                    effect: s.effect,
                    principals: s.principals,
                    except: s.except,
                    on: p.on,
                }
                policy.statements.push(statement)
                for (const principal of s.principals) push(this.statementsByPrincipal, principal, statement)
            }
            for (const a of p.approvals ?? []) policy.approvals.push(this.approval(a, lenient(`approvals ${p.on}`)))
        }
        for (const g of policies.guardrails ?? []) {
            const guardrail: Guardrail = {
                id: g.id,
                on: g.on,
                principals: g.principals ?? ["everyone"],
                except: g.except,
                deny: (g.deny ?? []).map(r => this.rule(r, lenient(`guardrail ${g.id}`))),
                ceiling: g.ceiling?.map(r => this.rule(r, lenient(`guardrail ${g.id}`))),
            }
            this.guardrails.push(guardrail)
            push(this.guardrailsByScope, g.on, guardrail)
        }
        for (const b of policies.boundaries ?? []) {
            const boundary: Boundary = {id: b.id, allow: b.allow.map(r => this.rule(r, lenient(`boundary ${b.id}`)))}
            for (const principal of b.principals) push(this.boundariesByPrincipal, principal, boundary)
        }
    }

    /** Authorizes the subject in GG_AUTHZ_SUBJECT; throws on denial. */
    public async authorize(action: GGAuthzActionRef, resource: string, context?: Record<string, unknown>, properties?: GGAuthzResourceProperties): Promise<GGAuthzDecision> {
        const name = typeof action === "string" ? action : action.name
        const request: GGAuthzRequest = {subject: this.contextSubject(), action: {name}, resource: {type: GGAuthzRn.type(resource) ?? "", id: resource, properties}, context}
        return this.enforce(request, await this.evaluate(request))
    }

    /** `canGrant` for the subject in GG_AUTHZ_SUBJECT, throwing like `authorize`. */
    public async authorizeGrant(binding: GGAuthzBinding, context?: Record<string, unknown>): Promise<GGAuthzDecision> {
        const subject = this.contextSubject()
        const action = this.model.grantAction ?? "grant"
        const request: GGAuthzRequest = {subject, action: {name: action}, resource: {type: GGAuthzRn.type(binding.on) ?? "", id: binding.on}, context}
        return this.enforce(request, await this.canGrant({subject, binding, context}))
    }

    /** The AuthZEN evaluation: never throws for a denial. */
    public async evaluate(request: GGAuthzRequest): Promise<GGAuthzDecision> {
        return this.evaluateWith(request, this.loader())
    }

    public async evaluateBatch(request: GGAuthzEvaluationsRequest): Promise<GGAuthzEvaluationsResponse> {
        const loader = this.loader()
        return {
            evaluations: await Promise.all(request.evaluations.map(e => {
                const subject = e.subject ?? request.subject
                const action = e.action ?? request.action
                const resource = e.resource ?? request.resource
                if (!subject || !action || !resource) throw new Error("Evaluation is missing subject, action or resource")
                const context = e.context || request.context ? {...request.context, ...e.context} : undefined
                return this.evaluateWith({subject, action, resource, context}, loader)
            })),
        }
    }

    /** May the subject create `binding`: `grantAction` there, and every action of the role through its own bindings. */
    public async canGrant(request: GGAuthzGrantRequest): Promise<GGAuthzDecision> {
        const {subject, binding, context} = request
        const on = binding.on
        if (!this.inPartition(on)) return invalid(`Invalid resource name ${on}`)
        const actions = this.roles.get(binding.role)
        if (!actions) return invalid(`Unknown role ${binding.role}`)
        const loader = this.loader()
        let granted: GGAuthzDecision = {decision: true, context: {outcome: "allow", reasons: []}}
        if (this.model.grantAction) {
            granted = await this.evaluateWith({subject, action: {name: this.model.grantAction}, resource: {type: GGAuthzRn.type(on)!, id: on}, context}, loader)
            if (!granted.decision) return granted
        }
        const missing = await this.missingWith(subject, [...actions], on, context, loader)
        if (!missing) return invalid(`Scope chain of ${on} is cyclic or deeper than ${MAX_DEPTH}`)
        if (missing.length) {
            return deny([{layer: "grant", kind: "escalation", role: binding.role, on, actions: missing, message: `granting role ${binding.role} on ${on} needs ${missing.join(", ")}, which the grantor doesn't hold there`}])
        }
        const held: GGAuthzReason = {layer: "grant", kind: "binding", role: binding.role, on, message: `the grantor holds every action of role ${binding.role} on ${on}`}
        return {...granted, context: {...granted.context, reasons: [...granted.context.reasons, held]}}
    }

    /** Which of `actions` the subject doesn't hold on `on`, as `canGrant` asks of a grantor; unknown actions are skipped. */
    public async missingActions(request: {subject: GGAuthzSubject, actions: readonly string[], on: string, context?: Record<string, unknown>}): Promise<string[] | undefined> {
        if (!this.inPartition(request.on)) return undefined
        return this.missingWith(request.subject, request.actions.filter(a => this.actions.has(a)), request.on, request.context, this.loader())
    }

    private async missingWith(subject: GGAuthzSubject, actions: readonly string[], on: string, context: Record<string, unknown> | undefined, loader: Loader): Promise<string[] | undefined> {
        const chain = await loader.chain(on)
        if (!chain) return undefined
        const p = await this.principals(subject, loader)
        const missing: string[] = []
        for (const action of actions) {
            const probe: GGAuthzRequest = {subject, action: {name: action}, resource: {type: GGAuthzRn.type(on)!, id: on}, context}
            const get = await this.lookup(probe, p, loader, this.rootsFor(subject))
            if (!this.decideWith(this.eval(probe, chain, p, get, new Map()), true).decision) missing.push(action)
        }
        return missing
    }

    /** A query plan for `GGAuthz.applyPlan`. Approval levels other than `humans-only` aren't in it: authorize the row you act on. */
    public async listAllowed(request: GGAuthzListRequest): Promise<GGAuthzPlan> {
        const action = request.action.name
        const resourceType = request.resource.type
        const plan: GGAuthzPlan = {action, resourceType, include: [], exclude: [], require: []}
        this.assertApplies(action, resourceType)
        const loader = this.loader()
        const p = await this.principals(request.subject, loader)
        if (p.workload && this.floorLevel(action) === HUMANS_ONLY) return plan
        const probe: GGAuthzRequest = {subject: request.subject, action: request.action, resource: {type: resourceType, id: ""}, context: request.context}
        const get = await this.lookup(probe, p, loader, {...this.rootsFor(request.subject), resource: false})
        const values: Record<string, unknown> = {}
        const residual = (within: string | undefined, source: Conditional & {resources?: string[]}, polarity: "allow" | "deny") => planFilter(within, source, polarity, get, values)

        const require: GGAuthzPlan["require"] = []
        for (const c of this.ceilings(request.subject, p)) {
            const anyOf = c.rules.filter(r => r.actions.has(action)).map(r => residual(undefined, r.source, "allow")).filter(f => f !== undefined)
            if (anyOf.some(f => !f.resources && !f.when && !f.unless && !f.conditions)) continue
            if (anyOf.length === 0 && !c.on) return plan
            require.push({id: c.id, within: c.on, anyOf})
        }

        const include: GGAuthzPlanFilter[] = []
        const exclude: GGAuthzPlanFilter[] = []
        const add = (list: GGAuthzPlanFilter[], f: GGAuthzPlanFilter | undefined) => f && list.push(f)
        for (const b of unique(p.authority.ids, this.bindingsByPrincipal)) {
            if (b.actions.has(action)) add(include, residual(b.on, b, "allow"))
        }
        for (const s of unique(p.anyIds, this.statementsByPrincipal)) {
            if (!s.actions.has(action)) continue
            if (s.effect === "allow" && matchAny(s.principals, p.authority.ids) && !matchAny(s.except, p.authority.ids)) add(include, residual(s.on, s.source, "allow"))
            if (s.effect === "deny" && applies(s.principals, s.except, p)) add(exclude, residual(s.on, s.source, "deny"))
        }
        if (include.length === 0) return plan
        for (const g of this.guardrails) {
            if (!applies(g.principals, g.except, p)) continue
            for (const r of g.deny) if (r.actions.has(action)) add(exclude, residual(g.on, r.source, "deny"))
        }
        if (p.workload) exclude.push(...await this.humansOnlyFilters(action, loader))
        return Object.keys(values).length ? {action, resourceType, include, exclude, require, values} : {action, resourceType, include, exclude, require}
    }

    private async enforce(request: GGAuthzRequest, decision: GGAuthzDecision): Promise<GGAuthzDecision> {
        if (!decision.decision) {
            const debug = {debugMessage: explain(request, decision)}
            const remedy = decision.context.remedy
            if (remedy?.scopes) throw new INSUFFICIENT_SCOPE({scopes: remedy.scopes}, debug)
            if (remedy?.stepUp) throw new STEP_UP_REQUIRED({facts: remedy.stepUp}, debug)
            throw new FORBIDDEN(debug)
        }
        if (decision.context.outcome === "allow-with-approval") {
            if (!this.approvals) throw new APPROVAL_REQUIRED({action: request.action.name, resource: request.resource.id, level: decision.context.approval!}, {debugMessage: explain(request, decision)})
            await this.approvals(request, decision)
        }
        return decision
    }

    private inPartition(rn: string): boolean {
        return GGAuthzRn.parse(rn)?.partition === this.model.partition
    }

    private contextSubject(): GGAuthzSubject {
        const subject = GG_AUTHZ_SUBJECT.get()
        if (!subject) throw new NOT_AUTHORIZED({debugMessage: "No GG_AUTHZ_SUBJECT in context"})
        return subject
    }

    private async evaluateWith(request: GGAuthzRequest, loader: Loader): Promise<GGAuthzDecision> {
        const action = request.action.name
        if (!this.actions.has(action)) throw new Error(`Unknown action ${action}`)
        const rn = request.resource.id
        if (!this.inPartition(rn)) return invalid(`Invalid resource name ${rn}`)
        const type = GGAuthzRn.type(rn)!
        if (request.resource.type !== type) throw new Error(`Resource type ${request.resource.type} does not match ${rn}`)
        this.assertApplies(action, type)
        const given = request.resource.properties?.ancestors
        const [chain, p] = await Promise.all([given ? checkedChain([rn, ...given]) : loader.chain(rn), this.principals(request.subject, loader)])
        if (!chain) return invalid(`Scope chain of ${rn} is cyclic or deeper than ${MAX_DEPTH}`)
        const get = await this.lookup(request, p, loader, this.rootsFor(request.subject))

        const facts = new Map<string, boolean | undefined>()
        const decision = this.decideWith(this.eval(request, chain, p, get, facts))
        if (decision.decision || decision.context.remedy) return decision
        const stepUp = this.stepUpFacts.filter(f => facts.has(f) && facts.get(f) !== true)
        if (stepUp.length && this.decideWith(this.eval(request, chain, p, get, new Map(stepUp.map(f => [f, true])))).decision) decision.context.remedy = {stepUp}
        return decision
    }

    private eval(request: GGAuthzRequest, chain: string[], p: Principals, get: AttributeLookup, facts: Map<string, boolean | undefined>): Eval {
        return {request, action: request.action.name, rn: request.resource.id, chain, chainSet: new Set(chain), p, get, facts}
    }

    /** `bindingsOnly`: only bindings grant, as `canGrant` needs; no remedies. There a deny the scope can't decide only
     *  because a `resource.*` operand is missing (no resource at a grant's scope) doesn't count against holding an
     *  action: it binds the grantee the same. Any other unknown — a principal, actor or context attribute, a fact the
     *  request didn't give — still denies. */
    private decideWith(e: Eval, bindingsOnly = false): GGAuthzDecision {
        const action = e.action
        const denies = (r: Rule) => bindingsOnly ? this.deniesHolding(r, e) : this.matches(r, e) !== false
        const denied: GGAuthzReason[] = []
        for (const scope of e.chain) {
            for (const g of this.guardrailsByScope.get(scope) ?? []) {
                if (!applies(g.principals, g.except, e.p)) continue
                for (const r of g.deny) {
                    if (denies(r)) denied.push({layer: "guardrail", kind: "denied", id: g.id, on: g.on, actions: r.source.actions})
                }
            }
            for (const s of this.policies.get(scope)?.statements ?? []) {
                if (s.effect === "deny" && applies(s.principals, s.except, e.p) && denies(s)) {
                    denied.push({layer: "deny", kind: "denied", id: s.sid, on: s.on, actions: s.source.actions})
                }
            }
        }
        if (denied.length) return deny(denied)

        const passed: GGAuthzReason[] = []
        const failed: GGAuthzReason[] = []
        for (const c of this.ceilings(e.request.subject, e.p, e.chainSet)) {
            const r = c.rules.find(r => this.matches(r, e) === true)
            const id = c.ids ? c.ids[c.rules.indexOf(r!)] ?? c.id : c.id
            if (r) passed.push({layer: c.layer, kind: "ceiling-passed", id, on: c.on, actions: r.source.actions})
            else failed.push({layer: c.layer, kind: "ceiling-failed", id: c.id, on: c.on})
        }
        if (failed.length) {
            if (!bindingsOnly && failed.every(f => f.layer === "scope") && this.grants(e).length && !(e.p.workload && this.approvalFor(action, e.chain).level === "humans-only")) {
                const scopes = [...this.tokenScopes].filter(([, rules]) => rules.some(r => this.matches(r, e) === true)).map(([name]) => name)
                if (scopes.length) return deny(failed, {scopes})
            }
            return deny(failed)
        }

        const allowed = this.grants(e, bindingsOnly)
        if (!allowed.length) return deny([{layer: "default", kind: "no-grant", message: "No binding or resource policy grants it"}])

        const reasons = [...allowed, ...passed]
        if (!e.p.workload) return {decision: true, context: {outcome: "allow", reasons}}
        const approval = this.approvalFor(action, e.chain)
        reasons.push(approval)
        if (approval.level === "humans-only") return deny([approval])
        return {
            decision: true,
            context: {outcome: approval.level === "auto" ? "allow" : "allow-with-approval", approval: approval.level, audit: true, reasons},
        }
    }

    private grants(e: Eval, bindingsOnly = false): GGAuthzReason[] {
        const allowed: GGAuthzReason[] = []
        const ids = e.p.authority.ids
        for (const scope of e.chain) {
            for (const b of this.bindingsByScope.get(scope) ?? []) {
                if (ids.has(b.principal) && b.actions.has(e.action) && this.conditions(b, e) === true) {
                    allowed.push({layer: "allow", kind: "binding", principal: b.principal, role: b.role, on: b.on})
                }
            }
            if (bindingsOnly) continue
            for (const s of this.policies.get(scope)?.statements ?? []) {
                if (s.effect === "allow" && matchAny(s.principals, ids) && !matchAny(s.except, ids) && this.matches(s, e) === true) {
                    allowed.push({layer: "allow", kind: "statement", id: s.sid, on: s.on, principal: s.principals.find(p => ids.has(p)), actions: s.source.actions})
                }
            }
        }
        return allowed
    }

    private ceilings(subject: GGAuthzSubject, p: Principals, chainSet?: Set<string>): Ceiling[] {
        const ceilings: Ceiling[] = []
        for (const g of this.guardrails) {
            if (g.ceiling && (!chainSet || chainSet.has(g.on)) && applies(g.principals, g.except, p)) ceilings.push({layer: "guardrail", id: g.id, on: g.on, rules: g.ceiling})
        }
        const boundaries = new Set<Boundary>()
        for (const actor of p.actors) for (const b of unique(actor.ids, this.boundariesByPrincipal)) boundaries.add(b)
        for (const b of boundaries) ceilings.push({layer: "boundary", id: b.id, rules: b.allow})
        const scopes = subject.properties?.scopes
        if (scopes) {
            const granted = [...new Set(scopes)].filter(s => this.tokenScopes.has(s))
            const rules = granted.flatMap(s => this.tokenScopes.get(s)!)
            ceilings.push({layer: "scope", id: "token scopes", rules, ids: granted.flatMap(s => this.tokenScopes.get(s)!.map(() => s))})
        }
        const restrictions = subject.properties?.restrictions
        if (restrictions) ceilings.push({layer: "restriction", id: "request restrictions", rules: restrictions.map(r => this.rule(r))})
        return ceilings
    }

    private approvalFor(action: string, chain: string[]): GGAuthzReason {
        let floor = this.floorLevel(action)
        let floorOn: string | undefined
        let level = -1
        let on: string | undefined
        let lowered: GGAuthzReason["lowered"]
        for (let i = chain.length - 1; i >= 0; i--) {
            const scope = chain[i]!
            const rules = this.policies.get(scope)?.approvals.filter(a => a.actions.has(action)) ?? []
            if (!rules.length) continue
            const set = Math.max(...rules.map(a => a.level))
            const locked = Math.max(-1, ...rules.filter(a => a.locked).map(a => a.level))
            lowered = set < floor ? {on: scope, level: GG_AUTHZ_APPROVAL_LEVELS[set]!} : undefined
            level = Math.max(set, floor)
            on = set < floor ? floorOn : scope
            if (locked > floor) {
                floor = locked
                floorOn = scope
            }
        }
        if (level < floor) {
            level = floor
            on = floorOn
        }
        const resolved = GG_AUTHZ_APPROVAL_LEVELS[Math.max(0, level)]!
        const message = on ? undefined : level < 0 ? "default" : "platform floor"
        return {layer: "approval", kind: "approval", level: resolved, on, locked: level >= 0 && level === floor, lowered, message}
    }

    private floorLevel(action: string): number {
        return Math.max(-1, ...this.approvalFloor.filter(a => a.actions.has(action)).map(a => a.level))
    }

    private async humansOnlyFilters(action: string, loader: Loader): Promise<GGAuthzPlanFilter[]> {
        const strict = new Map<string, boolean>()
        const lower: string[] = []
        for (const p of this.policies.values()) {
            const rules = p.approvals.filter(a => a.actions.has(action))
            if (!rules.length) continue
            if (Math.max(...rules.map(a => a.level)) < HUMANS_ONLY) lower.push(p.on)
            else strict.set(p.on, rules.some(a => a.locked && a.level === HUMANS_ONLY))
        }
        const chains = await Promise.all(lower.map(y => loader.chain(y)))
        const exceptions = new Map<string, string[]>()
        lower.forEach((y, i) => {
            for (const ancestor of chains[i]?.slice(1) ?? []) {
                if (strict.get(ancestor) === false) push(exceptions, ancestor, y)
            }
        })
        return [...strict].map(([on, locked]): GGAuthzPlanFilter => !locked && exceptions.has(on) ? {within: on, exceptWithin: exceptions.get(on)} : {within: on})
    }

    private assertApplies(action: string, type: string): void {
        const types = this.actions.get(action)
        if (!types) throw new Error(`Unknown action ${action}`)
        if (!types.has(type)) throw new Error(`${action} does not apply to ${type}`)
    }

    private loader(): Loader {
        const chains = new Map<string, Promise<string[] | undefined>>()
        const identities = new Map<string, Promise<Identity>>()
        const attributes = new Map<string, Promise<Attributes | undefined>>()
        const memo = <T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
            let value = map.get(key)
            if (!value) map.set(key, value = load())
            return value
        }
        const resolver = this.resolver
        return {
            chain: rn => memo(chains, rn, async () => {
                return checkedChain([rn, ...await resolver.ancestors(rn)])
            }),
            identity: entity => memo(identities, `${entity.type}:${entity.id}`, async () => {
                const key = `${entity.type}:${entity.id}`
                return {key, type: entity.type, ids: new Set([key, `${entity.type}:*`, "everyone", ...await resolver.groups(key)])}
            }),
            attributes: entity => memo(attributes, entity, async () => resolver.attributes?.(entity)),
        }
    }

    private async principals(subject: GGAuthzSubject, loader: Loader): Promise<Principals> {
        const human = subject.properties?.onBehalfOf
        const [actors, authority] = await Promise.all([
            Promise.all([{type: subject.type, id: subject.id}, ...subject.properties?.via ?? []].map(e => loader.identity(e))),
            human ? loader.identity(human) : undefined,
        ])
        const anyIds = new Set<string>()
        for (const identity of [...actors, ...authority ? [authority] : []]) for (const id of identity.ids) anyIds.add(id)
        return {actor: actors[0]!, actors, authority: authority ?? actors[0]!, anyIds, workload: actors.some(a => this.workloadTypes.has(a.type))}
    }

    private async lookup(request: GGAuthzRequest, p: Principals, loader: Loader, roots: Roots): Promise<AttributeLookup> {
        const [principal, actor, resource] = await Promise.all([
            roots.principal ? loader.attributes(p.authority.key) : undefined,
            roots.actor ? loader.attributes(p.actor.key) : undefined,
            roots.resource ? request.resource.properties?.attributes ?? loader.attributes(request.resource.id) : undefined,
        ])
        return key => {
            const dot = key.indexOf(".")
            const name = key.slice(dot + 1)
            switch (key.slice(0, dot)) {
                case "principal":
                    return name === "key" ? p.authority.key : principal?.[name]
                case "actor":
                    return name === "key" ? p.actor.key : actor?.[name]
                case "resource":
                    return name === "rn" ? request.resource.id : resource?.[name]
                default:
                    return request.context?.[name]
            }
        }
    }

    private rootsFor(subject: GGAuthzSubject): Roots {
        const restrictions = subject.properties?.restrictions
        if (!restrictions) return this.roots
        const roots = {...this.roots}
        for (const r of restrictions) mark(roots, r.conditions)
        return roots
    }

    private deniesHolding(r: Rule, e: Eval): boolean {
        const matched = this.matches(r, e)
        if (matched !== undefined) return matched
        return !(r.conditions ?? []).some(c => evalCondition(c, e.get) === undefined && this.unknownOnlyOnResource(c, e))
    }

    private unknownOnlyOnResource(c: GGAuthzCondition, e: Eval): boolean {
        const missing = [c.key, ...c.ref !== undefined ? [c.ref] : []].filter(key => e.get(key) === undefined || e.get(key) === null)
        return missing.length > 0 && missing.every(isResourceKey)
    }

    private matches(r: Rule, e: Eval): boolean | undefined {
        if (!r.actions.has(e.action)) return false
        if (r.resources && !r.resources.some(m => m.exact !== undefined ? e.rn === m.exact : m.prefix !== undefined ? e.rn.startsWith(m.prefix) : e.chainSet.has(m.within!))) return false
        return this.conditions(r, e)
    }

    private conditions(c: Conditional, e: Eval): boolean | undefined {
        if (!c.when && !c.unless) return evalConditions(c.conditions, e.get)
        return evalConditional(c, f => this.fact(f, e), e.get)
    }

    private fact(name: string, e: Eval): boolean | undefined {
        if (e.facts.has(name)) return e.facts.get(name)
        const value = this.facts(name, e.request)
        const known = typeof value === "boolean" ? value : undefined
        e.facts.set(name, known)
        return known
    }

    private rule(r: GGAuthzRule, onUnknown?: OnUnknownAction): Rule {
        mark(this.roots, r.conditions)
        return {
            actions: expandActions(this.actions, r.actions, onUnknown),
            resources: r.resources?.map(m => GGAuthzRn.isExact(m) ? {exact: m.slice(1)} : GGAuthzRn.isPattern(m) ? {prefix: m.slice(0, -1)} : {within: m}),
            when: r.when,
            unless: r.unless,
            conditions: r.conditions,
            source: r,
        }
    }

    private approval(a: {actions: string[], level: GGAuthzApprovalLevel, locked?: boolean}, onUnknown?: OnUnknownAction): Approval {
        return {actions: expandActions(this.actions, a.actions, onUnknown), level: GG_AUTHZ_APPROVAL_LEVELS.indexOf(a.level), locked: a.locked === true}
    }
}

function checkedChain(chain: string[]): string[] | undefined {
    return chain.length > MAX_DEPTH || new Set(chain).size !== chain.length ? undefined : chain
}

function invalid(message: string): GGAuthzDecision {
    return deny([{layer: "request", kind: "invalid", message}])
}

function deny(reasons: GGAuthzReason[], remedy?: GGAuthzRemedy): GGAuthzDecision {
    return {decision: false, context: remedy ? {outcome: "deny", reasons, remedy} : {outcome: "deny", reasons}}
}

/**
 * The plan filter for a rule, with conditions that don't involve the row decided now: one that can't hold drops an allow
 * filter, and one that can't fail is left out. The rest stay residual, with the non-row values they reference in `values`.
 */
function planFilter(within: string | undefined, source: Conditional & {resources?: string[]}, polarity: "allow" | "deny", get: AttributeLookup, values: Record<string, unknown>): GGAuthzPlanFilter | undefined {
    const residual: GGAuthzCondition[] = []
    for (const c of source.conditions ?? []) {
        if (isResourceKey(c.key) || (c.ref !== undefined && isResourceKey(c.ref))) {
            residual.push(c)
            for (const key of [c.key, c.ref]) {
                if (key === undefined || isResourceKey(key)) continue
                const value = get(key)
                if (value !== undefined && value !== null) values[key] = value
            }
            continue
        }
        const value = evalCondition(c, get)
        if (value === false || (value === undefined && polarity === "allow")) return undefined
    }
    const f: GGAuthzPlanFilter = {}
    if (within !== undefined) f.within = within
    if (source.resources) f.resources = source.resources
    if (source.when) f.when = source.when
    if (source.unless) f.unless = source.unless
    if (residual.length) f.conditions = residual
    return f
}

function mark(roots: Roots, conditions: GGAuthzCondition[] | undefined): void {
    for (const c of conditions ?? []) {
        for (const key of [c.key, c.ref]) {
            if (key?.startsWith("principal.") && key !== "principal.key") roots.principal = true
            if (key?.startsWith("actor.") && key !== "actor.key") roots.actor = true
            if (key?.startsWith("resource.") && key !== "resource.rn") roots.resource = true
        }
    }
}

// Each identity must clear a deny on its own: an exempt workload doesn't carry a non-exempt human through, or the reverse.
function applies(principals: string[] | undefined, except: string[] | undefined, p: Principals): boolean {
    const hits = (set: Set<string>) => matchAny(principals ?? ["everyone"], set) && !matchAny(except, set)
    return p.actors.some(a => hits(a.ids)) || hits(p.authority.ids)
}

function matchAny(selectors: string[] | undefined, ids: Set<string>): boolean {
    return !!selectors && selectors.some(s => ids.has(s))
}

function unique<T>(ids: Set<string>, index: Map<string, T[]>): Set<T> {
    const out = new Set<T>()
    for (const id of ids) for (const item of index.get(id) ?? []) out.add(item)
    return out
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
}
