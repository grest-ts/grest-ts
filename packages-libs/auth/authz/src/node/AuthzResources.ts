import {GGContextKey} from "@grest-ts/context"
import {type GGPermission, GGPermissionChecker, type GGRequirementResource, type GGSchema, IsAny, NOT_FOUND, requirementField} from "@grest-ts/schema"
import {GGAuthzRn} from "../shared/GGAuthzRn"
import type {GGAuthzResourceProperties} from "../shared/authzSchemas"

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

export interface GGAuthzCall {
    api: string
    method: string
}

/** The contract call in progress, opened by the authority's `authorize`: the actions its requirements declare and what
 *  `once` keeps for it, such as one read of each row. Every authority reads the same one. */
interface CallState {
    call: GGAuthzCall
    actions: Set<string>
    // Per owner: two authorities never serve each other's rows.
    kept: WeakMap<object, Map<string, Promise<unknown>>>
}

// Set once per call: a pipeline that runs several calls in one request runs each in a context of its own, so one call's
// declared actions and rows never reach another.
const GG_AUTHZ_CALL = new GGContextKey<CallState>("authzCall", IsAny as unknown as GGSchema<CallState>)

export function openCall(call: GGAuthzCall, actions: Iterable<string>): void {
    GG_AUTHZ_CALL.set({call, actions: new Set(actions), kept: new WeakMap()})
}

export function currentCall(): {call: GGAuthzCall, actions: ReadonlySet<string>} | undefined {
    return GG_AUTHZ_CALL.get()
}

/** From here on in the call, `action` counts as declared. */
export function declareInCall(action: string): void {
    GG_AUTHZ_CALL.get()?.actions.add(action)
}

/** `GGAuthzAuthority.once`, per `owner`. */
export function once<T>(owner: object, key: string, fn: () => Promise<T>): Promise<T> {
    const state = GG_AUTHZ_CALL.get()
    if (!state) return fn()
    let kept = state.kept.get(owner)
    if (!kept) state.kept.set(owner, kept = new Map())
    let made = kept.get(key) as Promise<T> | undefined
    if (!made) {
        kept.set(key, made = fn().then(value => {
            if (value === undefined) kept.delete(key)
            return value
        }, e => {
            kept.delete(key)
            throw e
        }))
    }
    return made
}

/** Resolves what requirements and handlers name to resources in the caller's tenant, through the registered loaders. */
export class AuthzResources {

    private readonly loaders = new Map<string, GGAuthzLoader>()
    private readonly partition: string
    private readonly tenantType: string
    private readonly tenant: () => string
    private readonly contexts: Record<string, () => string | undefined> | undefined

    constructor(partition: string, tenantType: string, tenant: () => string, contexts: Record<string, () => string | undefined> | undefined) {
        this.partition = partition
        this.tenantType = tenantType
        this.tenant = tenant
        this.contexts = contexts
    }

    public register(type: string, loader: GGAuthzLoader): void {
        if (this.loaders.has(type)) throw new Error(`A loader for ${type} is already registered`)
        this.loaders.set(type, loader)
    }

    public assertLoaders(contracts: readonly {name: string, methods: Readonly<Record<string, {permission?: GGPermission}>>}[]): void {
        const problems: string[] = []
        for (const contract of contracts) {
            for (const [method, {permission}] of Object.entries(contract.methods)) {
                for (const r of GGPermissionChecker.requirementsOf(permission)) {
                    for (const resource of [r.resource, r.createOn]) {
                        if (resource?.in) {
                            for (const t of resource.in.types) if (t !== this.tenantType && !this.loaders.has(t)) problems.push(`${contract.name}.${method}: no loader for ${t}, a parent of ${resource.type}`)
                            continue
                        }
                        if (!resource || resource.type === this.tenantType) continue
                        if (!resource.id) problems.push(`${contract.name}.${method}: ${resource.type} has no id, and only ${this.tenantType} means the caller's tenant`)
                        else if (!this.loaders.has(resource.type)) problems.push(`${contract.name}.${method}: no loader for ${resource.type}`)
                    }
                }
            }
        }
        if (problems.length) throw new Error(`Requirements the authority can't resolve:\n  ${problems.join("\n  ")}`)
    }

    /** The row as this call read it, e.g. when its requirement was decided. */
    public async row<T>(type: string, id: string): Promise<T> {
        this.rnOf(type, id)
        const loaded = await this.read(this.tenant(), type, id)
        if (!loaded) throw new NOT_FOUND({displayMessage: "Not found", debugMessage: `${type} ${id} not found`})
        if (loaded.row === undefined) throw new Error(`The ${type} loader gives no row`)
        return loaded.row as T
    }

    /** A resource's properties, e.g. for a loader whose row hangs off another; undefined when it doesn't exist. */
    public async properties(type: string, id: string): Promise<GGAuthzResourceProperties | undefined> {
        return (await this.read(this.tenant(), type, id))?.properties
    }

    /** The resource a requirement names, from the call's input. */
    public refOf(resource: GGRequirementResource, fields: Record<string, unknown>): GGAuthzResourceRef {
        if (!resource.in) return {type: resource.type, id: this.idOf(resource, fields)}
        const parent = requirementField(fields, resource.in.field) as {type?: unknown, id?: unknown} | undefined
        if (typeof parent?.type !== "string" || typeof parent.id !== "string" || !resource.in.types.includes(parent.type)) {
            throw new Error(`Requirement field ${resource.in.field} is not a parent of ${resource.type}`)
        }
        return {type: parent.type, id: parent.id}
    }

    /** NOT_FOUND when it doesn't exist in the caller's tenant. */
    public async resolve(resource: GGAuthzResourceRef): Promise<GGAuthzResolvedResource> {
        const tenant = this.tenant()
        const notFound = () => new NOT_FOUND({displayMessage: "Not found", debugMessage: `${resource.type} ${resource.id} not found`})
        const rn = this.rnOf(resource.type, resource.id)
        let properties = resource.properties
        if (!properties) {
            if (resource.type === this.tenantType) {
                if (resource.id !== tenant) throw notFound()
                properties = {ancestors: []}
            } else {
                properties = (await this.read(tenant, resource.type, resource.id))?.properties
                if (!properties) throw notFound()
            }
        }
        return {type: resource.type, id: resource.id, rn, tenant, properties}
    }

    // Within a call, one read of each row: its requirements, the handler's checks and `row` see the same one. A miss isn't
    // kept: the handler may create the row and then decide on it.
    private read(tenant: string, type: string, id: string): Promise<GGAuthzLoaded | undefined> {
        const loader = this.loaders.get(type)
        if (!loader) throw new Error(`No loader registered for ${type}`)
        return once(this, `${tenant} ${type} ${id}`, async () => loader(tenant, id))
    }

    private idOf(resource: GGRequirementResource, fields: Record<string, unknown>): string {
        const id = resource.id
        if (!id) {
            if (resource.type !== this.tenantType) throw new Error(`A requirement on ${resource.type} without an id: only ${this.tenantType} means the caller's tenant`)
            return this.tenant()
        }
        if ("field" in id) {
            const value = requirementField(fields, id.field)
            if (typeof value !== "string") throw new Error(`Requirement field ${id.field} is not a string`)
            return value
        }
        const source = this.contexts?.[id.context]
        if (!source) throw new Error(`No context source ${id.context}`)
        const value = source()
        if (value === undefined) throw new NOT_FOUND({displayMessage: "Not found", debugMessage: `Context source ${id.context} gave no id`})
        return value
    }

    /** The RN of a resource in the caller's tenant; NOT_FOUND for an id that can't be one. */
    public rnOf(type: string, id: string): string {
        const [service, kind] = type.split(":") as [string, string]
        const rn = `rn:${this.partition}:${service}:${this.tenant()}:${kind}/${id}`
        if (!GGAuthzRn.REGEX.test(rn)) throw new NOT_FOUND({displayMessage: "Not found", debugMessage: `${type} ${id} is not a valid resource`})
        return rn
    }
}
