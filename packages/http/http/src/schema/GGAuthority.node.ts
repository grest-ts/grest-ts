/**
 * Server half of GGAuthority: bind the decision into a runtime and run it for each requirement. Node-only —
 * keeps @grest-ts/locator out of the browser bundle.
 */
import {GGLocator, GGLocatorKey} from "@grest-ts/locator"
import type {GGRequirement} from "@grest-ts/schema"
import {GGAuthority} from "./GGAuthority"

export interface GGAuthorityCall {
    api: string
    method: string
}

export interface GGAuthorityHandler {
    /** A contract call starts, in its own request context, before any of its `requirements` (none, too) is authorized. */
    begin?(call: GGAuthorityCall, requirements: readonly GGRequirement[]): void
    /** Throw one of the requirement's `errors` to refuse; return to allow. `input` is already validated. */
    authorize(requirement: GGRequirement, input: unknown, call: GGAuthorityCall): Promise<void>
}

const HANDLER_KEYS = new WeakMap<GGAuthority, GGLocatorKey<GGAuthorityHandler>>()
const DEFINED = new WeakSet<GGAuthority>()
let nextAuthorityId = 0

function handlerKeyFor(authority: GGAuthority): GGLocatorKey<GGAuthorityHandler> {
    let key = HANDLER_KEYS.get(authority)
    if (!key) {
        key = new GGLocatorKey<GGAuthorityHandler>(`authority:${authority.name}:${nextAuthorityId++}`)
        HANDLER_KEYS.set(authority, key)
    }
    return key
}

/** Returned by `.define()`; `.create(deps)` binds the handler once per runtime scope. */
export class GGAuthorityRegistration<Deps> {
    private readonly authority: GGAuthority
    private readonly factory: (deps: Deps) => GGAuthorityHandler

    constructor(authority: GGAuthority, factory: (deps: Deps) => GGAuthorityHandler) {
        this.authority = authority
        this.factory = factory
    }

    public create(deps: Deps): void {
        const key = handlerKeyFor(this.authority)
        if (GGLocator.getScope().has(key)) {
            throw new Error(`Authority "${this.authority.name}" was already created in this runtime scope - .create() runs once per runtime.`)
        }
        GGLocator.getScope().set(key, this.factory(deps))
    }
}

declare module "./GGAuthority" {
    interface GGAuthority {
        /** Attach the server-side decision. Process-global, once — a second call throws. */
        define<Deps>(factory: (deps: Deps) => GGAuthorityHandler): GGAuthorityRegistration<Deps>

        /** @internal server pipeline hook. */
        begin(call: GGAuthorityCall, requirements: readonly GGRequirement[]): void

        /** @internal server pipeline hook. */
        authorize(requirement: GGRequirement, input: unknown, call: GGAuthorityCall): Promise<void>

        /** @internal startup validation — true once .create() has run on the current runtime scope. */
        hasHandler(): boolean
    }
}

GGAuthority.prototype.define = function (factory) {
    if (DEFINED.has(this)) throw new Error(`Authority "${this.name}" already has .define() - it can only be defined once.`)
    DEFINED.add(this)
    return new GGAuthorityRegistration(this, factory as any)
}

GGAuthority.prototype.begin = function (call, requirements) {
    // Only requirements need the handler (checkPermissionsAtStart): a call without any may run before .create().
    handlerKeyFor(this).tryGet()?.begin?.(call, requirements)
}

GGAuthority.prototype.authorize = async function (requirement, input, call) {
    await handlerOf(this).authorize(requirement, input, call)
}

function handlerOf(authority: GGAuthority): GGAuthorityHandler {
    const handler = handlerKeyFor(authority).tryGet()
    if (!handler) throw new Error(`Authority "${authority.name}" is used but not implemented - call ${authority.name}.define(...).create(deps) in compose().`)
    return handler
}

GGAuthority.prototype.hasHandler = function () {
    return handlerKeyFor(this).has()
}
