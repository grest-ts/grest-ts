import {FORBIDDEN, type GGPermission, type GGRequirement, NOT_AUTHORIZED, NOT_FOUND, requirementField} from "@grest-ts/schema"
import {actionName, type GGAuthzActionRef} from "../shared/defineAuthz"
import {APPROVAL_REQUIRED} from "../shared/authzErrors"
import {GG_AUTHZ_SUBJECT} from "./GG_AUTHZ_SUBJECT"
import {GGAuthz, type GGAuthzVerdict} from "./GGAuthz"
import {
    AuthzResources,
    currentCall,
    type GGAuthzCall,
    type GGAuthzLoader,
    type GGAuthzResolvedResource,
    type GGAuthzResourceRef,
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
type RefusalError = Extract<GGAuthzVerdict, {outcome: "denied"}>["error"]

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

/** One decision, once its answer is final. `call`: the contract call it was made in; `grant`: from `authorizeGrant`,
 *  whose `action` is the engine's grant action; `holds`: one of the actions `assertHolds` checked. */
export type GGAuthzDecided = {
    action: string
    resource: GGAuthzResolvedResource
    subject: GGAuthzSubject
    call?: GGAuthzCall
    decision: GGAuthzDecision
    grant?: GGAuthzGrant
    holds?: true
} & (
    | {outcome: "allowed"}
    | {outcome: "approved", level: GGAuthzApprovalLevel}
    | {outcome: "unapproved", level: GGAuthzApprovalLevel, error: unknown}
    | {outcome: "denied", refusal: GGAuthzRefusal, hidden: boolean, error: RefusalError | InstanceType<typeof NOT_FOUND>}
)

/** A refusal before it's answered, with the request's facts: `refused` may hide it or explain it. */
export type GGAuthzRefused = Pick<GGAuthzDecided, "action" | "resource" | "subject" | "call" | "decision"> & {refusal: GGAuthzRefusal, facts: Facts}

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
     *  key, for the caller to ask and retry). Without it the authority throws APPROVAL_REQUIRED itself. */
    approvals?(need: GGAuthzApprovalNeed): Promise<void>
    /** Shapes a refusal a requirement didn't `.hide()`: `"hide"` answers NOT_FOUND; a FORBIDDEN replaces a FORBIDDEN refusal
     *  (e.g. to say why), never a step-up or scope one, whose remedy the caller needs; undefined keeps it. A throw fails the
     *  call. Listings filter instead, so they never get here. */
    refused?(refusal: GGAuthzRefused): Awaitable<"hide" | InstanceType<typeof FORBIDDEN> | undefined>
    /** Every decision, once its answer is final. For audit and alerting: a throw or an async listener's rejection is
     *  ignored. Listings filter instead, so they never get here. */
    decided?(event: GGAuthzDecided): void
    /** A handler decided an action its call's requirements don't declare (`assert`, `can`; `allowed` filters, so it's
     *  free). Throw to refuse it. */
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
     *  `refused`) hides it. An allow that needs approval goes to `approvals`, for `key` when the approval is for another
     *  resource than the one decided. */
    public async assert(action: GGAuthzActionRef, resource: GGAuthzResourceRef, options?: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<void> {
        const name = this.checked(action)
        await this.decide(name, await this.resources.resolve(resource), options ?? {})
    }

    public async can(action: GGAuthzActionRef, resource: GGAuthzResourceRef): Promise<boolean> {
        this.checked(action)
        return (await this.allowedEach([{action, resource}]))[0]!
    }

    /** One decision per resource, e.g. to filter a listing. A resource that doesn't resolve is not allowed, and neither
     *  is one a workload may act on only once approved: only `assert` asks for approvals. */
    public allowed(action: GGAuthzActionRef, resources: readonly GGAuthzResourceRef[]): Promise<boolean[]> {
        return this.allowedEach(resources.map(resource => ({action, resource})))
    }

    /** `allowed` for checks of different actions, in one batch. */
    public async allowedEach(checks: readonly {action: GGAuthzActionRef, resource: GGAuthzResourceRef}[]): Promise<boolean[]> {
        const subject = this.subject()
        // A filter decides nothing a caller acts on, so `undeclared` doesn't ask about it.
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
        await this.answer(request, await engine.canGrant({subject, binding}), resolved, undefined, {grant: {role, principal}})
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
        const resolved = {type: resource.type, id: resource.id, rn: this.resources.rnOf(resource.type, resource.id), tenant, properties: resource.properties ?? {ancestors: []}}
        const names = actions.map(actionName)
        const decision = await engine.canHold({subject, actions: names, on: resolved.rn, context: options?.context})
        const missing = GGAuthz.notHeld(decision, names)
        const error = missing.length ? new FORBIDDEN({displayMessage: options?.displayMessage, debugMessage: `${subject.type}:${subject.id} doesn't hold ${missing.join(", ")} on ${resolved.rn}`}) : undefined
        if (this.config.decided) {
            const call = currentCall()?.call
            for (const action of names) {
                const base = {action, resource: resolved, subject, call, decision, holds: true as const}
                this.heard(error && missing.includes(action) ? {...base, outcome: "denied", refusal: "FORBIDDEN", hidden: false, error} : {...base, outcome: "allowed"})
            }
        }
        if (error) throw error
    }

    private async decide(action: string, resource: GGAuthzResolvedResource, options: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<void> {
        const [engine, facts] = await Promise.all([this.config.engine(resource.tenant), this.config.facts?.(action, resource)])
        const request = this.request(this.subject(), action, resource, facts)
        await this.answer(request, await engine.evaluate(request), resource, facts, options)
    }

    // The one place a decision becomes an answer: allowed, approved or not, or refused (hidden or explained).
    private async answer(request: GGAuthzRequest, decision: GGAuthzDecision, resource: GGAuthzResolvedResource, facts: Facts, options: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}, grant?: GGAuthzGrant}): Promise<void> {
        const verdict = GGAuthz.verdict(request, decision)
        const event = () => ({action: request.action.name, resource, subject: request.subject, call: currentCall()?.call, decision, grant: options.grant})
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
                grant: options.grant,
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
        const shaped = options.hidden ? "hide" : await this.config.refused?.({...event(), facts, refusal: verdict.refusal})
        const explained = verdict.refusal === "FORBIDDEN" && shaped !== "hide" ? shaped : undefined
        const error = shaped === "hide" ? new NOT_FOUND({displayMessage: "Not found", debugMessage: verdict.error.getDebugContext()?.debugMessage}) : explained ?? verdict.error
        if (this.config.decided) this.heard({...event(), outcome: "denied", refusal: verdict.refusal, hidden: shaped === "hide", error})
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
