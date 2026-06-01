/**
 * Server/inbound half of the wire model: define/create the verification handler, run it during
 * the request pipeline (process), and expose the caller's grants to the permission gate
 * (permissions). Node-only — keeps @grest-ts/locator out of the browser bundle.
 */
import {GGLocator, GGLocatorKey} from "@grest-ts/locator"
import type {GGTransportMiddleware} from "@grest-ts/context"
import {GGWireContextKey} from "./GGWireContextKey"

/**
 * The scope resolver a set of wired middlewares contributes: the union of each smart wire's
 * permissions() (each wire's process() already authenticated-or-threw). Returns undefined when no
 * smart wire is present — the schema is then ungated unless a manual resolver is supplied. Shared
 * by the HTTP and WebSocket register paths so the derivation lives in exactly one place.
 */
export function deriveWireScopeResolver(
    middlewares: readonly GGTransportMiddleware[],
): (() => Promise<ReadonlySet<string>>) | undefined {
    const smartWires = middlewares.filter(
        (mw): mw is GGWireContextKey => mw instanceof GGWireContextKey && mw.isSmart,
    )
    if (smartWires.length === 0) return undefined
    return async () => {
        const scopes = new Set<string>()
        for (const wire of smartWires) {
            for (const p of await wire.permissions()) scopes.add(p)
        }
        return scopes
    }
}

export interface GGWireServerHandler {
    /** Verify the raw credential and mint the durable principal. Throws to reject the request. */
    process: () => Promise<void>
    /** The caller's grants from this wire — read off the durable principal minted in process(). */
    permissions?: () => Promise<readonly string[]>
}

const HANDLER_KEYS = new WeakMap<GGWireContextKey, GGLocatorKey<GGWireServerHandler>>()
const FACTORIES = new WeakMap<GGWireContextKey, unknown>()

function handlerKeyFor(wire: GGWireContextKey): GGLocatorKey<GGWireServerHandler> {
    let key = HANDLER_KEYS.get(wire)
    if (!key) {
        key = new GGLocatorKey<GGWireServerHandler>(`wire:${wire.name}`)
        HANDLER_KEYS.set(wire, key)
    }
    return key
}

function resolveHandler(wire: GGWireContextKey): GGWireServerHandler {
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
export class GGWireHandlerRegistration<Deps> {
    constructor(
        private readonly wire: GGWireContextKey,
        private readonly factory: (deps: Deps) => GGWireServerHandler,
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
    interface GGWireContextKey {
        /** Attach the server-side verification handler. Process-global, frozen once — a second call throws. */
        define<Deps>(factory: (deps: Deps) => GGWireServerHandler): GGWireHandlerRegistration<Deps>
        /** @internal server pipeline hook — verify the credential and mint the durable principal. */
        process(): Promise<void>
        /** @internal permission-gate hook — the caller's grants from this wire. */
        permissions(): Promise<readonly string[]>
        /** @internal startup validation — true once .create() has run on the current runtime scope. */
        hasHandler(): boolean
        /** @internal true once .define() has run — distinguishes verified wires from ambient ones. */
        isDefined(): boolean
        /** Drop the ephemeral raw credential after process(); ambient wires keep their value. */
        clear(): void
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
