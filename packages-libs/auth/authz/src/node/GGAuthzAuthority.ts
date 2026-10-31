import {FORBIDDEN, type GGPermission, GGPermissionChecker, type GGRequirement, type GGRequirementResource, NOT_AUTHORIZED, NOT_FOUND, requirementField} from "@grest-ts/schema"
import {actionName, type GGAuthzActionRef} from "../shared/defineAuthz"
import {APPROVAL_REQUIRED, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED} from "../shared/authzErrors"
import {GG_AUTHZ_SUBJECT} from "./GG_AUTHZ_SUBJECT"
import type {GGAuthz} from "./GGAuthz"
import {GGAuthzRn} from "../shared/GGAuthzRn"
import {GG_AUTHZ_APPROVAL_LEVELS, type GGAuthzApprovalLevel, type GGAuthzRequest, type GGAuthzResourceProperties} from "../shared/authzSchemas"

type Awaitable<T> = T | Promise<T>

/** A row's ancestors and attributes, and the row itself for the handler (`row`). */
export interface GGAuthzLoaded {
    properties: GGAuthzResourceProperties
    row?: unknown
}

/** Undefined when the row doesn't exist in this tenant (answered NOT_FOUND). */
export type GGAuthzLoader = (tenant: string, id: string) => Awaitable<GGAuthzLoaded | undefined>

/** A resource for `assert`/`can`; with `properties` (from the row the handler loaded) no loader runs. */
export interface GGAuthzResourceRef {
    type: string
    id: string
    properties?: GGAuthzResourceProperties
}

export interface GGAuthzResolvedResource {
    type: string
    id: string
    rn: string
    tenant: string
    properties: GGAuthzResourceProperties
}

/** An allow that needs the approval of `level` for `key` (by default the decided resource itself). */
export interface GGAuthzApprovalNeed {
    action: string
    resource: GGAuthzResolvedResource
    key: {type: string, id: string, rn: string}
    level: GGAuthzApprovalLevel
}

/** Names what an approval of `action` is for when it isn't the decided resource, e.g. the new row of a create. */
export type GGAuthzApprovalKey = (input: Record<string, unknown>, resource: GGAuthzResolvedResource) => {type: string, id: string}

export interface GGAuthzCall {
    api: string
    method: string
}

export interface GGAuthzAuthorityConfig {
    partition: string
    /** The tenant's own resource type (e.g. `org:org`): a requirement naming it without an id is the caller's tenant. */
    tenantType: string
    tenant(): string
    engine(tenant: string): Promise<GGAuthz>
    /** Request-time facts for this action on this resource; given to the engine in the request context. */
    facts?(action: string, resource: GGAuthzResolvedResource): Awaitable<Record<string, boolean> | undefined>
    /** `onContext` sources: the resource id this request implies. */
    contexts?: Record<string, () => string | undefined>
    /** An allow that needs approval: return when a live approval covers it, else throw (`APPROVAL_REQUIRED` with the
     *  key, for the caller to ask and retry). Without it the authority throws APPROVAL_REQUIRED itself. */
    approvals?(need: GGAuthzApprovalNeed): Promise<void>
    /** A resource attribute holding an approval level that raises the engine's (e.g. a critical secret). */
    approvalLevelAttribute?: string
    /** Whether a denial of `action` on this resource answers NOT_FOUND without `.hide()`, e.g. on what someone else owns. */
    hidden?(resource: GGAuthzResolvedResource, action: string): boolean
    /** A FORBIDDEN that says why, in place of a decided, unhidden denial of `action` on this resource; undefined, or a
     *  throw, keeps the denial. Only `assert`/`authorize` ask: listings filter instead. */
    explainForbidden?(action: string, resource: GGAuthzResolvedResource): Promise<InstanceType<typeof FORBIDDEN> | undefined>
    /** A handler decided an action its method's requirements don't name (`assert`, `can` or `approvalNeed`, in a
     *  request that ran requirements; `allowed` filters, so it's free). Throw to refuse it. */
    undeclared?(call: GGAuthzCall, action: string): void
}

/** Decides `GGRequirement`s for a grest-ts authority, and the state-dependent checks handlers make on top. */
export class GGAuthzAuthority {

    private readonly loaders = new Map<string, GGAuthzLoader>()
    // Per request, keyed by the subject its wire set: a requirement's parts and the handler share one read of each row.
    private readonly loadedBy = new WeakMap<object, Map<string, Promise<GGAuthzLoaded | undefined>>>()
    private readonly approvalKeys = new Map<string, GGAuthzApprovalKey>()
    // Per request, like loadedBy: the method and the actions its requirements named.
    private readonly declaredBy = new WeakMap<object, {call: GGAuthzCall, actions: Set<string>}>()

    private readonly config: GGAuthzAuthorityConfig

    constructor(config: GGAuthzAuthorityConfig) {
        this.config = config
    }

    public register(type: string, loader: GGAuthzLoader): void {
        if (this.loaders.has(type)) throw new Error(`A loader for ${type} is already registered`)
        this.loaders.set(type, loader)
    }

    /** For requirements on `action`: what its approval is for, from the input (handlers pass `key` to `assert`). */
    public registerApprovalKey(action: GGAuthzActionRef, key: GGAuthzApprovalKey): void {
        const name = actionName(action)
        if (this.approvalKeys.has(name)) throw new Error(`An approval key for ${name} is already registered`)
        this.approvalKeys.set(name, key)
    }

    public load(tenant: string, type: string, id: string): Promise<GGAuthzLoaded | undefined> {
        const loader = this.loaders.get(type)
        if (!loader) throw new Error(`No loader registered for ${type}`)
        const subject = GG_AUTHZ_SUBJECT.get()
        if (!subject) return Promise.resolve(loader(tenant, id))
        let loaded = this.loadedBy.get(subject)
        if (!loaded) this.loadedBy.set(subject, loaded = new Map())
        const key = `${tenant} ${type} ${id}`
        let row = loaded.get(key)
        if (!row) {
            const read = Promise.resolve(loader(tenant, id))
            loaded.set(key, row = read.catch(e => {
                loaded.delete(key)
                throw e
            }))
        }
        return row
    }

    public async row<T>(type: string, id: string): Promise<T> {
        this.rnOf(type, id)
        const loaded = await this.load(this.config.tenant(), type, id)
        if (!loaded) throw new NOT_FOUND({displayMessage: "Not found", debugMessage: `${type} ${id} not found`})
        if (loaded.row === undefined) throw new Error(`The ${type} loader gives no row`)
        return loaded.row as T
    }

    /** Throws, listing each method whose requirement names a type that needs a row but has no loader. Run it once
     *  every contract this authority decides is mounted and every loader is registered. */
    public assertLoaders(contracts: readonly {name: string, methods: Readonly<Record<string, {permission?: GGPermission}>>}[]): void {
        const problems: string[] = []
        for (const contract of contracts) {
            for (const [method, {permission}] of Object.entries(contract.methods)) {
                for (const r of GGPermissionChecker.requirementsOf(permission)) {
                    for (const resource of [r.resource, r.createOn]) {
                        if (resource?.in) {
                            for (const t of resource.in.types) if (t !== this.config.tenantType && !this.loaders.has(t)) problems.push(`${contract.name}.${method}: no loader for ${t}, a parent of ${resource.type}`)
                            continue
                        }
                        if (!resource || resource.type === this.config.tenantType) continue
                        if (!resource.id) problems.push(`${contract.name}.${method}: ${resource.type} has no id, and only ${this.config.tenantType} means the caller's tenant`)
                        else if (!this.loaders.has(resource.type)) problems.push(`${contract.name}.${method}: no loader for ${resource.type}`)
                    }
                }
            }
        }
        if (problems.length) throw new Error(`Requirements the authority can't resolve:\n  ${problems.join("\n  ")}`)
    }

    /** The grest-ts `GGAuthorityHandler` method. */
    public readonly authorize = async (requirement: GGRequirement, input: unknown, call?: GGAuthzCall): Promise<void> => {
        const subject = GG_AUTHZ_SUBJECT.get()
        if (subject && call) {
            const declared = this.declaredBy.get(subject)
            if (declared) declared.actions.add(requirement.action)
            else this.declaredBy.set(subject, {call, actions: new Set([requirement.action])})
        }
        // A listing filters itself, but only within the caller's tenant: no tenant, no listing.
        if (requirement.list) return void this.config.tenant()
        const fields = (input ?? {}) as Record<string, unknown>
        const id = requirement.resource!.id
        const creating = requirement.createOn && (id && "field" in id ? requirementField(fields, id.field) : undefined) === undefined
        const target = creating ? requirement.createOn! : requirement.resource!
        const keyOf = this.approvalKeys.get(requirement.action)
        await this.enforce(requirement.action, this.refOf(target, fields), {hidden: requirement.hidden, key: keyOf && (resource => keyOf(fields, resource))})
    }

    private checked(action: GGAuthzActionRef): void {
        const subject = GG_AUTHZ_SUBJECT.get()
        const declared = subject && this.config.undeclared && this.declaredBy.get(subject)
        const name = actionName(action)
        if (declared && !declared.actions.has(name)) this.config.undeclared!(declared.call, name)
    }

    /** Throws like `GGAuthz.authorize`; with `hidden` (or the config's), a denial is NOT_FOUND. An allow that needs
     *  approval goes to the configured `approvals`, for `key` when the approval is for another resource than the one
     *  decided. */
    public async assert(action: GGAuthzActionRef, resource: GGAuthzResourceRef, options?: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<void> {
        this.checked(action)
        return this.enforce(action, resource, options)
    }

    private async enforce(action: GGAuthzActionRef, resource: GGAuthzResourceRef, options?: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<void> {
        const need = await this.decide(action, resource, options)
        if (!need) return
        if (this.config.approvals) return this.config.approvals(need)
        throw new APPROVAL_REQUIRED({action: need.action, resource: need.resource.rn, level: need.level, key: need.key.rn === need.resource.rn ? undefined : need.key.rn})
    }

    private async denial(e: unknown, action: string, resource: GGAuthzResolvedResource, hidden?: boolean): Promise<unknown> {
        if ((hidden || this.config.hidden?.(resource, action)) && (FORBIDDEN.is(e) || INSUFFICIENT_SCOPE.is(e) || STEP_UP_REQUIRED.is(e))) {
            return new NOT_FOUND({displayMessage: "Not found", debugMessage: (e as {context?: {debugMessage?: string}}).context?.debugMessage})
        }
        if (FORBIDDEN.is(e)) return await this.config.explainForbidden?.(action, resource).catch(() => undefined) ?? e
        return e
    }

    /** What an approval for `action` on `resource` would need, or undefined when it's allowed without one. Throws like
     *  `assert` when it isn't allowed at all. For asking the approval a refused call named. */
    public async approvalNeed(action: GGAuthzActionRef, resource: GGAuthzResourceRef, key?: {type: string, id: string}): Promise<GGAuthzApprovalNeed | undefined> {
        this.checked(action)
        return this.decide(action, resource, {key: key && (() => key)})
    }

    private async decide(action: GGAuthzActionRef, resource: GGAuthzResourceRef, options?: {hidden?: boolean, key?: (resource: GGAuthzResolvedResource) => {type: string, id: string}}): Promise<GGAuthzApprovalNeed | undefined> {
        const name = actionName(action)
        const resolved = await this.resolve(resource)
        const [engine, facts] = await Promise.all([this.config.engine(resolved.tenant), this.config.facts?.(name, resolved)])
        try {
            await engine.authorize(name, resolved.rn, facts, resolved.properties)
            return undefined
        } catch (e) {
            if (APPROVAL_REQUIRED.is(e)) return this.need(name, resolved, e.data!.level, options?.key?.(resolved))
            throw await this.denial(e, name, resolved, options?.hidden)
        }
    }

    private need(action: string, resource: GGAuthzResolvedResource, level: GGAuthzApprovalLevel, key?: {type: string, id: string}): GGAuthzApprovalNeed {
        const raised = this.config.approvalLevelAttribute && resource.properties.attributes?.[this.config.approvalLevelAttribute]
        const rank = (l: unknown) => GG_AUTHZ_APPROVAL_LEVELS.indexOf(l as GGAuthzApprovalLevel)
        const effective = rank(raised) > rank(level) ? raised as GGAuthzApprovalLevel : level
        return {action, resource, level: effective, key: key ? {...key, rn: this.rnOf(key.type, key.id)} : {type: resource.type, id: resource.id, rn: resource.rn}}
    }

    public async can(action: GGAuthzActionRef, resource: GGAuthzResourceRef): Promise<boolean> {
        this.checked(action)
        return (await this.allowed(action, [resource]))[0]!
    }

    /** Which of `actions` the caller doesn't hold on `resource` through their own roles (no-escalation, as `canGrant`).
     *  `context` gives the facts that hold there (an unknown one counts against holding an action). */
    public async missingActions(actions: readonly GGAuthzActionRef[], resource: GGAuthzResourceRef, context?: Record<string, unknown>): Promise<string[]> {
        const subject = GG_AUTHZ_SUBJECT.get()
        if (!subject) throw new NOT_AUTHORIZED({debugMessage: "No GG_AUTHZ_SUBJECT in context"})
        const resolved = await this.resolve(resource)
        const engine = await this.config.engine(resolved.tenant)
        const names = actions.map(actionName)
        return await engine.missingActions({subject, actions: names, on: resolved.rn, context}) ?? names
    }

    /** `canGrant` of `role` to `principal` on `resource`, throwing like `GGAuthz.authorizeGrant`. */
    public async authorizeGrant(role: string, principal: string, resource: GGAuthzResourceRef): Promise<void> {
        const resolved = await this.resolve(resource)
        await (await this.config.engine(resolved.tenant)).authorizeGrant({principal, role, on: resolved.rn})
    }

    /** One decision per resource, e.g. to filter a listing. A resource that doesn't resolve is not allowed, and
     *  neither is one a workload may act on only once approved: only `assert` asks for approvals. */
    public allowed(action: GGAuthzActionRef, resources: readonly GGAuthzResourceRef[]): Promise<boolean[]> {
        return this.allowedEach(resources.map(resource => ({action, resource})))
    }

    public async allowedEach(checks: readonly {action: GGAuthzActionRef, resource: GGAuthzResourceRef}[]): Promise<boolean[]> {
        const subject = GG_AUTHZ_SUBJECT.get()
        if (!subject) throw new NOT_AUTHORIZED({debugMessage: "No GG_AUTHZ_SUBJECT in context"})
        const engine = await this.config.engine(this.config.tenant())
        const evaluations = await Promise.all(checks.map(async ({action, resource}): Promise<GGAuthzRequest | undefined> => {
            const name = actionName(action)
            const resolved = await this.resolve(resource).catch(e => {
                if (NOT_FOUND.is(e)) return undefined
                throw e
            })
            if (!resolved) return undefined
            const context = await this.config.facts?.(name, resolved)
            return {subject, action: {name}, resource: {type: resolved.type, id: resolved.rn, properties: resolved.properties}, context}
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

    private refOf(resource: GGRequirementResource, fields: Record<string, unknown>): GGAuthzResourceRef {
        if (!resource.in) return {type: resource.type, id: this.idOf(resource, fields)}
        const parent = requirementField(fields, resource.in.field) as {type?: unknown, id?: unknown} | undefined
        if (typeof parent?.type !== "string" || typeof parent.id !== "string" || !resource.in.types.includes(parent.type)) {
            throw new Error(`Requirement field ${resource.in.field} is not a parent of ${resource.type}`)
        }
        return {type: parent.type, id: parent.id}
    }

    private idOf(resource: GGRequirementResource, fields: Record<string, unknown>): string {
        const id = resource.id
        if (!id) {
            if (resource.type !== this.config.tenantType) throw new Error(`A requirement on ${resource.type} without an id: only ${this.config.tenantType} means the caller's tenant`)
            return this.config.tenant()
        }
        if ("field" in id) {
            const value = requirementField(fields, id.field)
            if (typeof value !== "string") throw new Error(`Requirement field ${id.field} is not a string`)
            return value
        }
        const source = this.config.contexts?.[id.context]
        if (!source) throw new Error(`No context source ${id.context}`)
        const value = source()
        if (value === undefined) throw new NOT_FOUND({displayMessage: "Not found", debugMessage: `Context source ${id.context} gave no id`})
        return value
    }

    /** The RN of a resource in the caller's tenant; NOT_FOUND for an id that can't be one. */
    public rnOf(type: string, id: string): string {
        const [service, kind] = type.split(":") as [string, string]
        const rn = `rn:${this.config.partition}:${service}:${this.config.tenant()}:${kind}/${id}`
        if (!GGAuthzRn.REGEX.test(rn)) throw new NOT_FOUND({displayMessage: "Not found", debugMessage: `${type} ${id} is not a valid resource`})
        return rn
    }

    private async resolve(resource: GGAuthzResourceRef): Promise<GGAuthzResolvedResource> {
        const tenant = this.config.tenant()
        const notFound = () => new NOT_FOUND({displayMessage: "Not found", debugMessage: `${resource.type} ${resource.id} not found`})
        const rn = this.rnOf(resource.type, resource.id)
        let properties = resource.properties
        if (!properties) {
            if (resource.type === this.config.tenantType) {
                if (resource.id !== tenant) throw notFound()
                properties = {ancestors: []}
            } else {
                properties = (await this.load(tenant, resource.type, resource.id))?.properties
                if (!properties) throw notFound()
            }
        }
        return {type: resource.type, id: resource.id, rn, tenant, properties}
    }
}
