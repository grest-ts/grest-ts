import {FORBIDDEN, type GGPermission, type GGRequirement, NOT_AUTHORIZED, NOT_FOUND, requirementField} from "@grest-ts/schema"
import {actionName, type GGAuthzActionRef} from "../shared/defineAuthz"
import {APPROVAL_REQUIRED} from "../shared/authzErrors"
import {GG_AUTHZ_SUBJECT} from "./GG_AUTHZ_SUBJECT"
import {GGAuthz} from "./GGAuthz"
import {
    AuthzResources,
    currentCall,
    type GGAuthzCall,
    type GGAuthzLoader,
    type GGAuthzResolvedResource,
    type GGAuthzResourceRef,
    once,
    openCall,
} from "./AuthzResources"
import {
    type GGAuthzApprovalLevel,
    type GGAuthzDecision,
    type GGAuthzRefusal,
    type GGAuthzRequest,
    type GGAuthzResourceProperties,
    type GGAuthzSubject,
} from "../shared/authzSchemas"

type Awaitable<T> = T | Promise<T>
type Facts = Record<string, boolean> | undefined

/** An allow that needs the approval of `level` for `key` (by default the decided resource itself); `grant`: the role
 *  grant it is for, from `authorizeGrant`. */
export interface GGAuthzApprovalNeed {
    action: string
    resource: GGAuthzResolvedResource
    key: {type: string, id: string, rn: string}
    level: GGAuthzApprovalLevel
    grant?: GGAuthzGrant
}

/** Names what an approval of `action` is for when it isn't the decided resource, e.g. the new row of a create. */
export type GGAuthzApprovalKey = (input: Record<string, unknown>, resource: GGAuthzResolvedResource) => {type: string, id: string}

export interface GGAuthzGrant {
    role: string
    principal: string
}

/** A scope `assertHolds` decides on: its RN in the caller's tenant, without its row. */
export interface GGAuthzScope {
    type: string
    id: string
    rn: string
    tenant: string
}

/** What was decided: an `action` on a resource (`assert`, a requirement), a role `grant` on it (`authorizeGrant`; `action`
 *  is the engine's grant action), or whether the caller `holds` actions on a scope (`assertHolds`). */
export type GGAuthzCheck =
    | {check: "action", action: string, resource: GGAuthzResolvedResource}
    | {check: "grant", action: string, role: string, principal: string, resource: GGAuthzResolvedResource}
    | {check: "holds", actions: readonly string[], missing: readonly string[], scope: GGAuthzScope}

/** One decision, once its answer is final; `call`: the contract call it was made in. */
export type GGAuthzDecided = GGAuthzCheck & {
    subject: GGAuthzSubject
    call?: GGAuthzCall
    decision: GGAuthzDecision
} & (
    | {outcome: "allowed"}
    | {outcome: "approved", level: GGAuthzApprovalLevel}
    | {outcome: "unapproved", level: GGAuthzApprovalLevel, error: unknown}
    | {outcome: "denied", refusal: GGAuthzRefusal, hidden: boolean, error: unknown}
)

/** An action refused on a resource, before it's answered, with the request's facts: `hides` and `explains` shape it. */
export interface GGAuthzRefused {
    action: string
    resource: GGAuthzResolvedResource
    subject: GGAuthzSubject
    call?: GGAuthzCall
    decision: GGAuthzDecision
    refusal: GGAuthzRefusal
    facts: Facts
}

type ResourceCheck = Extract<GGAuthzCheck, {check: "action" | "grant"}>

export interface GGAuthzAuthorityConfig {
    partition: string
    /** The tenant's own resource type (e.g. `org:org`): a requirement naming it without an id is the caller's tenant. */
    tenantType: string
    tenant(): string
    engine(tenant: string): Promise<GGAuthz>
    /** Request-time facts for this action on this resource; given to the engine in the request context. */
    facts?(action: string, resource: GGAuthzResolvedResource): Awaitable<Facts>
    /** `onContext` sources: the resource id this request implies. */
    contexts?: Record<string, () => string | undefined>
    /** An allow that needs approval: return when a live approval covers it, else throw (`APPROVAL_REQUIRED` with the
     *  key, for the caller to ask and retry). Without it the authority throws APPROVAL_REQUIRED itself. A grant's key is
     *  its scope: match `need.grant` (role and principal) too, or one approval covers any grant there. */
    approvals?(need: GGAuthzApprovalNeed): Promise<void>
    /** True answers an action's refusal a requirement didn't `.hide()` with NOT_FOUND: the caller isn't told it exists.
     *  Grants and holds checks are about what the caller holds, so they're answered as they are; listings filter instead.
     *  A throw is the answer, as from `explains`. */
    hides?(refusal: GGAuthzRefused): Awaitable<boolean>
    /** A FORBIDDEN to answer a FORBIDDEN refusal that isn't hidden with, e.g. saying why; undefined keeps it. Never asked
     *  for a step-up or scope refusal, whose remedy the caller needs. */
    explains?(refusal: GGAuthzRefused): Awaitable<InstanceType<typeof FORBIDDEN> | undefined>
    /** Every decision, once its answer is final. For audit and alerting: a throw or an async listener's rejection is
     *  ignored. Listings filter instead, so they never get here. */
    decided?(event: GGAuthzDecided): void
    /** A handler decided an action its call's requirements don't declare (`assert`, `can`; a `peek` decides nothing, so
     *  it's free). Throw to refuse it. */
    undeclared?(call: GGAuthzCall, action: string): void
}

/** Decides `GGRequirement`s for a grest-ts authority, and the state-dependent checks handlers make on top: the one place
 *  an engine decision becomes an answer. */
export class GGAuthzAuthority {

    private readonly resources: AuthzResources
    private readonly approvalKeys = new Map<string, GGAuthzApprovalKey>()
    private readonly config: GGAuthzAuthorityConfig

    constructor(config: GGAuthzAuthorityConfig) {
        this.config = config
        this.resources = new AuthzResources(config.partition, config.tenantType, config.tenant, config.contexts)
    }

    public register(type: string, loader: GGAuthzLoader): void {
        this.resources.register(type, loader)
    }

    /** For requirements on `action`: what its approval is for, from the input (handlers pass `key` to `assert`). */
    public registerApprovalKey(action: GGAuthzActionRef, key: GGAuthzApprovalKey): void {
        const name = actionName(action)
        if (this.approvalKeys.has(name)) throw new Error(`An approval key for ${name} is already registered`)
        this.approvalKeys.set(name, key)
    }

    /** Throws, listing each method whose requirement names a type that needs a row but has no loader. Run it once
     *  every contract this authority decides is mounted and every loader is registered. */
    public assertLoaders(contracts: readonly {name: string, methods: Readonly<Record<string, {permission?: GGPermission}>>}[]): void {
        this.resources.assertLoaders(contracts)
    }

    /** The row as this call read it, e.g. when its requirement was decided; NOT_FOUND when it doesn't exist. */
    public row<T>(type: string, id: string): Promise<T> {
        return this.resources.row<T>(type, id)
    }

    /** A resource's properties, e.g. for a loader whose row hangs off another's; undefined when it doesn't exist. */
    public properties(type: string, id: string): Promise<GGAuthzResourceProperties | undefined> {
        return this.resources.properties(type, id)
    }

    /** `fn`'s promise, once per `key` within this call, as rows are read once: e.g. a fact the hooks compute. A failure
     *  or an `undefined` isn't kept; outside a call it just runs. */
    public once<T>(key: string, fn: () => Promise<T>): Promise<T> {
        return once(this, key, fn)
    }

    /** The grest-ts `GGAuthorityHandler` method: a contract call, before its handler runs. Opens the call (what the
     *  handler's checks are compared with, and one read of each row) and decides each of its requirements. */
    public readonly authorize = async (call: GGAuthzCall, requirements: readonly GGRequirement[], input: unknown): Promise<void> => {
        openCall(call, requirements.map(r => r.action))
        for (const requirement of requirements) await this.requirement(requirement, input)
    }

    private async requirement(requirement: GGRequirement, input: unknown): Promise<void> {
        // A listing filters itself, but only within the caller's tenant: no tenant, no listing.
        if (requirement.list) return void this.config.tenant()
        const fields = (input ?? {}) as Record<string, unknown>
        const id = requirement.resource!.id
        const creating = requirement.createOn && (id && "field" in id ? requirementField(fields, id.field) : undefined) === undefined
        const target = this.resources.refOf(creating ? requirement.createOn! : requirement.resource!, fields)
        const keyOf = this.approvalKeys.get(requirement.action)
        const resource = await this.resources.resolve(target)
        await this.decide(requirement.action, resource, {hidden: requirement.hidden, key: keyOf && (r => keyOf(fields, r))})
    }

    /** Throws like a requirement: FORBIDDEN, STEP_UP_REQUIRED or INSUFFICIENT_SCOPE, NOT_FOUND when `hidden` (or
     *  `hides`) hides it. An allow that needs approval goes to `approvals`, for `key` when the approval is for another
     *  resource than the one decided. */
    public async assert(action: GGAuthzActionRef, resource: GGAuthzResourceRef, options?: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<void> {
        const name = this.checked(action)
        await this.decide(name, await this.resources.resolve(resource), options ?? {})
    }

    public async can(action: GGAuthzActionRef, resource: GGAuthzResourceRef): Promise<boolean> {
        this.checked(action)
        return (await this.peekEach([{action, resource}]))[0]!
    }

    /** Whether each resource would be allowed, without it counting as a decision: not declared, not audited, never asks
     *  for approval. For filtering a listing or hinting a UI; a handler acting on the answer uses `can`. A resource that
     *  doesn't resolve is not allowed, and neither is one a workload may act on only once approved. */
    public peek(action: GGAuthzActionRef, resources: readonly GGAuthzResourceRef[]): Promise<boolean[]> {
        return this.peekEach(resources.map(resource => ({action, resource})))
    }

    /** `peek` for checks of different actions, in one batch. */
    public async peekEach(checks: readonly {action: GGAuthzActionRef, resource: GGAuthzResourceRef}[]): Promise<boolean[]> {
        const subject = this.subject()
        const names = checks.map(c => actionName(c.action))
        const engine = await this.config.engine(this.config.tenant())
        const evaluations = await Promise.all(checks.map(async ({resource}, i): Promise<GGAuthzRequest | undefined> => {
            const resolved = await this.resources.resolve(resource).catch(e => {
                if (NOT_FOUND.is(e)) return undefined
                throw e
            })
            if (!resolved) return undefined
            return this.request(subject, names[i]!, resolved, await this.config.facts?.(names[i]!, resolved))
        }))
        const asked = evaluations.filter(e => e !== undefined)
        const decisions = asked.length ? (await engine.evaluateBatch({evaluations: asked})).evaluations : []
        let next = 0
        return evaluations.map(e => {
            if (e === undefined) return false
            const d = decisions[next++]!
            return d.decision && d.context.outcome !== "allow-with-approval"
        })
    }

    /** `canGrant` of `role` to `principal` on `resource` for the caller: throws like `assert`. */
    public async authorizeGrant(role: string, principal: string, resource: GGAuthzResourceRef): Promise<void> {
        const subject = this.subject()
        const [resolved, engine] = await Promise.all([this.resources.resolve(resource), this.config.engine(this.config.tenant())])
        const binding = {principal, role, on: resolved.rn}
        const request = engine.grantRequest(subject, binding)
        const check = {check: "grant" as const, action: request.action.name, role, principal, resource: resolved}
        await this.answer(check, request, await engine.canGrant({subject, binding}), undefined, {})
    }

    /** Throws FORBIDDEN unless the caller holds every one of `actions` on `resource` through its own roles, e.g. before
     *  handing them out (no-escalation, as `authorizeGrant`). Decided on the resource's RN, without loading it.
     *  `context`: the facts that hold there. */
    public async assertHolds(actions: readonly GGAuthzActionRef[], resource: GGAuthzResourceRef, options?: {context?: Record<string, unknown>, displayMessage?: string}): Promise<void> {
        const subject = this.subject()
        const tenant = this.config.tenant()
        if (resource.type === this.config.tenantType && resource.id !== tenant) throw new NOT_FOUND({displayMessage: "Not found", debugMessage: `${resource.type} ${resource.id} not found`})
        const engine = await this.config.engine(tenant)
        // A scope, not a row: decided on its RN, so it holds also where the row is gone (e.g. undoing a stale assignment).
        const scope = {type: resource.type, id: resource.id, rn: this.resources.rnOf(resource.type, resource.id), tenant}
        const names = actions.map(actionName)
        const decision = await engine.canHold({subject, actions: names, on: scope.rn, context: options?.context})
        const missing = GGAuthz.notHeld(decision, names)
        const error = missing.length ? new FORBIDDEN({displayMessage: options?.displayMessage, debugMessage: `${subject.type}:${subject.id} doesn't hold ${missing.join(", ")} on ${scope.rn}`}) : undefined
        if (this.config.decided) {
            const base = {check: "holds" as const, actions: names, missing, scope, subject, call: currentCall()?.call, decision}
            this.heard(error ? {...base, outcome: "denied", refusal: "FORBIDDEN", hidden: false, error} : {...base, outcome: "allowed"})
        }
        if (error) throw error
    }

    private async decide(action: string, resource: GGAuthzResolvedResource, options: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<void> {
        const [engine, facts] = await Promise.all([this.config.engine(resource.tenant), this.config.facts?.(action, resource)])
        const request = this.request(this.subject(), action, resource, facts)
        await this.answer({check: "action", action, resource}, request, await engine.evaluate(request), facts, options)
    }

    // The one place a decision on a resource becomes an answer: allowed, approved or not, or refused (an action's hidden or
    // explained). A hook's throw is the answer, and is heard as the refusal's.
    private async answer(check: ResourceCheck, request: GGAuthzRequest, decision: GGAuthzDecision, facts: Facts, options: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<void> {
        const {resource} = check
        const verdict = GGAuthz.verdict(request, decision)
        const event = () => ({...check, subject: request.subject, call: currentCall()?.call, decision})
        if (verdict.outcome === "allowed") {
            if (this.config.decided) this.heard({...event(), outcome: "allowed"})
            return
        }
        if (verdict.outcome === "approval-required") {
            const {level} = verdict
            const key = options.key?.(resource)
            const need: GGAuthzApprovalNeed = {
                action: request.action.name,
                resource,
                level,
                key: key ? {...key, rn: this.resources.rnOf(key.type, key.id)} : {type: resource.type, id: resource.id, rn: resource.rn},
                grant: check.check === "grant" ? {role: check.role, principal: check.principal} : undefined,
            }
            try {
                if (!this.config.approvals) {
                    throw new APPROVAL_REQUIRED({action: need.action, resource: resource.rn, level, key: need.key.rn === resource.rn ? undefined : need.key.rn}, {debugMessage: GGAuthz.explain(request, decision)})
                }
                await this.config.approvals(need)
            } catch (error) {
                if (this.config.decided) this.heard({...event(), outcome: "unapproved", level, error})
                throw error
            }
            if (this.config.decided) this.heard({...event(), outcome: "approved", level})
            return
        }
        const {refusal} = verdict
        let hidden = options.hidden === true
        let error: unknown
        try {
            const refused = check.check === "action" ? {...event(), action: check.action, facts, refusal} : undefined
            if (!hidden && refused) hidden = await this.config.hides?.(refused) ?? false
            const explained = !hidden && refused && refusal === "FORBIDDEN" ? await this.config.explains?.(refused) : undefined
            error = hidden ? new NOT_FOUND({displayMessage: "Not found", debugMessage: verdict.error.getDebugContext()?.debugMessage}) : explained ?? verdict.error
        } catch (e) {
            error = e
        }
        if (this.config.decided) this.heard({...event(), outcome: "denied", refusal, hidden, error})
        throw error
    }

    private heard(event: GGAuthzDecided): void {
        try {
            const heard: unknown = this.config.decided!(event)
            if (heard instanceof Promise) heard.catch(() => undefined)
        } catch { /* a notification: never changes the answer */ }
    }

    private checked(action: GGAuthzActionRef): string {
        const name = actionName(action)
        const state = this.config.undeclared && currentCall()
        if (state && !state.actions.has(name)) this.config.undeclared!(state.call, name)
        return name
    }

    private subject(): GGAuthzSubject {
        const subject = GG_AUTHZ_SUBJECT.get()
        if (!subject) throw new NOT_AUTHORIZED({debugMessage: "No GG_AUTHZ_SUBJECT in context"})
        return subject
    }

    private request(subject: GGAuthzSubject, action: string, resource: GGAuthzResolvedResource, facts: Facts): GGAuthzRequest {
        return {subject, action: {name: action}, resource: {type: resource.type, id: resource.rn, properties: resource.properties}, context: facts}
    }
}
