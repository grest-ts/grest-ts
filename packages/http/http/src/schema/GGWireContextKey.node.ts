/**
 * Server/inbound half of the wire model: define/create the verification handler, run it during
 * the request pipeline (process), and expose the caller's grants to the permission gate
 * (permissions). Node-only — keeps @grest-ts/locator out of the browser bundle.
 */
import {GGLocator, GGLocatorKey} from "@grest-ts/locator"
import {GGWireContextKey} from "./GGWireContextKey"

export interface GGWireServerHandler<P extends string = string> {
    /** Verify the raw credential and mint the durable principal. Throws to reject the request. */
    process: () => Promise<void>
    /** The caller's grants from this wire — read off the durable principal minted in process(). */
    permissions?: () => Promise<readonly P[]>
}

const HANDLER_KEYS = new WeakMap<GGWireContextKey<any>, GGLocatorKey<GGWireServerHandler>>()
const FACTORIES = new WeakMap<GGWireContextKey<any>, unknown>()

function handlerKeyFor(wire: GGWireContextKey<any>): GGLocatorKey<GGWireServerHandler> {
    let key = HANDLER_KEYS.get(wire)
    if (!key) {
        key = new GGLocatorKey<GGWireServerHandler>(`wire:${wire.name}`)
        HANDLER_KEYS.set(wire, key)
    }
    return key
}

function resolveHandler(wire: GGWireContextKey<any>): GGWireServerHandler {
    const handler = handlerKeyFor(wire).tryGet()
    if (!handler) {
        throw new Error(`Wire "${wire.name}" is used but not implemented — call ${wire.name}.define(...).create(deps) in compose().`)
    }
    return handler
}

/**
 * Binds the verification handler's deps into one runtime's locator scope. Returned by
 * `.define()`; `.create(deps)` runs once per scope (a fresh worker / restart gets its own).
 */
export class GGWireHandlerRegistration<Deps, P extends string> {
    constructor(
        private readonly wire: GGWireContextKey<P>,
        private readonly factory: (deps: Deps) => GGWireServerHandler<P>,
    ) {}

    public create(deps: Deps): void {
        const key = handlerKeyFor(this.wire)
        if (GGLocator.getScope().has(key)) {
            throw new Error(`Wire "${this.wire.name}" was already created in this runtime scope — .create() runs once per runtime.`)
        }
        GGLocator.getScope().set(key, this.factory(deps))
    }
}

declare module "./GGWireContextKey" {
    interface GGWireContextKey<P extends string> {
        /** Attach the server-side verification handler. Process-global, frozen once — a second call throws. */
        define<Deps>(factory: (deps: Deps) => GGWireServerHandler<P>): GGWireHandlerRegistration<Deps, P>
        /** @internal server pipeline hook — verify the credential and mint the durable principal. */
        process(): Promise<void>
        /** @internal permission-gate hook — the caller's grants from this wire. */
        permissions(): Promise<readonly P[]>
        /** @internal startup validation — true once .create() has run on the current runtime scope. */
        hasHandler(): boolean
    }
}

GGWireContextKey.prototype.define = function (factory) {
    if (FACTORIES.has(this)) {
        throw new Error(`Wire "${this.name}" already has .define() — it can only be defined once.`)
    }
    FACTORIES.set(this, factory)
    return new GGWireHandlerRegistration(this, factory as any)
}

GGWireContextKey.prototype.process = async function () {
    if (!this.isSmart) return
    await resolveHandler(this).process()
}

GGWireContextKey.prototype.permissions = async function () {
    if (!this.isSmart) return []
    const handler = resolveHandler(this)
    return handler.permissions ? await handler.permissions() : []
}

GGWireContextKey.prototype.hasHandler = function () {
    return handlerKeyFor(this).has()
}
