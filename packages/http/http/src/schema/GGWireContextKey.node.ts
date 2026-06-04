/**
 * Server/inbound half of the wire model: define/create the verification handler, run it during
 * the request pipeline (process), and expose the caller's grants to the permission gate
 * (permissions). Node-only — keeps @grest-ts/locator out of the browser bundle.
 */
import {GGLocator, GGLocatorKey} from "@grest-ts/locator"
import {GGWireContextKey} from "./GGWireContextKey"

export interface GGWireServerHandler {
    /** Verify the raw credential and mint the durable principal. Throws to reject the request. */
    process: () => Promise<void>
    /** The caller's grants from this wire — read off the durable principal minted in process(). */
    permissions?: () => Promise<readonly string[]>
}

const HANDLER_KEYS = new WeakMap<GGWireContextKey, GGLocatorKey<GGWireServerHandler>>()
const FACTORIES = new WeakMap<GGWireContextKey, unknown>()

// Locator keys resolve by their string name, so the handler key must be unique per wire
// instance — two wires over the same name (e.g. a public ambient cookie and a gated one
// over the same cookie name) must not share a handler.
let nextWireHandlerId = 0

/** True once .define() has run on this wire — distinguishes verified wires from ambient ones. */
export function wireIsDefined(wire: GGWireContextKey): boolean {
    return FACTORIES.has(wire)
}

function handlerKeyFor(wire: GGWireContextKey): GGLocatorKey<GGWireServerHandler> {
    let key = HANDLER_KEYS.get(wire)
    if (!key) {
        key = new GGLocatorKey<GGWireServerHandler>(`wire:${wire.name}:${nextWireHandlerId++}`)
        HANDLER_KEYS.set(wire, key)
    }
    return key
}

function resolveHandler(wire: GGWireContextKey): GGWireServerHandler {
    const handler = handlerKeyFor(wire).tryGet()
    if (!handler) {
        throw new Error(`Wire "${wire.name}" is used but not implemented - call ${wire.name}.define(...).create(deps) in compose().`)
    }
    return handler
}

/**
 * Binds the verification handler's deps into one runtime's locator scope. Returned by
 * `.define()`; `.create(deps)` runs once per scope (a fresh worker / restart gets its own).
 */
export class GGWireHandlerRegistration<Deps> {
    private readonly wire: GGWireContextKey
    private readonly factory: (deps: Deps) => GGWireServerHandler
    constructor(
        wire: GGWireContextKey,
        factory: (deps: Deps) => GGWireServerHandler,
    ) {
        this.wire = wire
        this.factory = factory
    }

    public create(deps: Deps): void {
        const key = handlerKeyFor(this.wire)
        if (GGLocator.getScope().has(key)) {
            throw new Error(`Wire "${this.wire.name}" was already created in this runtime scope - .create() runs once per runtime.`)
        }
        GGLocator.getScope().set(key, this.factory(deps))
    }
}

declare module "./GGWireContextKey" {
    interface GGWireContextKey {
        /** Attach the server-side verification handler. Process-global, frozen once — a second call throws. */
        define<Deps>(factory: (deps: Deps) => GGWireServerHandler): GGWireHandlerRegistration<Deps>

        /** @internal server pipeline hook — verify the credential and mint the durable principal. */
        process(): Promise<void>

        /** @internal If wire is handling permissions **/
        hasPermissions(): boolean;

        /** @internal permission-gate hook — the caller's grants from this wire. */
        getGrantedPermissions(): Promise<readonly string[]>

        /** @internal startup validation — true once .create() has run on the current runtime scope. */
        hasHandler(): boolean

        /** Drop the ephemeral raw credential after process(); ambient wires keep their value. */
        clear(): void
    }
}

GGWireContextKey.prototype.define = function (factory) {
    if (FACTORIES.has(this)) {
        throw new Error(`Wire "${this.name}" already has .define() - it can only be defined once.`)
    }
    FACTORIES.set(this, factory)
    return new GGWireHandlerRegistration(this, factory as any)
}

GGWireContextKey.prototype.process = async function () {
    if (!this.hasHandler()) return
    await resolveHandler(this).process()
}

GGWireContextKey.prototype.hasPermissions = function (): boolean {
    if (!this.hasHandler()) return false
    const handler = resolveHandler(this)
    return !!handler.permissions
}

GGWireContextKey.prototype.getGrantedPermissions = async function () {
    if (!this.hasHandler()) return []
    const handler = resolveHandler(this)
    return handler.permissions ? await handler.permissions() : []
}

GGWireContextKey.prototype.hasHandler = function () {
    return handlerKeyFor(this).has()
}

GGWireContextKey.prototype.clear = function () {
    if (this.hasHandler() && this.has()) this.delete()
}
