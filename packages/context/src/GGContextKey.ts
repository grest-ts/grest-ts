import {GGContextStore} from "./GGContextStore";
import {GGSchema} from "@grest-ts/schema";

export interface GGContextMeta<T> {
    description?: string
    defaultValue?: T
    mutable?: boolean
}

/** Where each key name was defined. A context stores values by name, and so does the testkit when it carries a
 *  context to a runtime worker: two keys with one name would share a value. */
const definedKeys = new Map<string, string | undefined>()

export class GGContextKey<Type> {

    public readonly name: string
    public readonly schema: GGSchema<Type>
    public readonly description?: string
    public readonly defaultValue?: Type
    public readonly mutable: boolean

    constructor(name: string, schema: GGSchema<Type>, meta?: GGContextMeta<Type>) {
        registerName(name)
        this.name = name
        this.schema = schema;
        this.description = meta?.description
        this.defaultValue = meta?.defaultValue
        this.mutable = meta?.mutable ?? false
    }

    public get(): Type | undefined {
        return GGContextStore.tryGetContext()?.get(this) ?? this.defaultValue
    }

    public has(): boolean {
        return GGContextStore.tryGetContext()?.has(this) ?? false
    }

    public set(value: Type): void {
        GGContextStore.getContext().set(this, value)
    }

    public delete(): void {
        GGContextStore.getContext().delete(this)
    }

    /**
     * Asserts that context value for this key exists. If not, throws Error.
     */
    public assert(): Type {
        if (!this.has()) {
            throw new Error(`Context named '${this.name}' is required, but not defined!`);
        }
        return this.get() as Type
    }
}

// The same name from the same place is that module evaluated again (HMR, vitest projects), not a second key. An HMR
// edit above a key before a reload still reads as a second one.
function registerName(name: string): void {
    const place = definitionPlace()
    const known = definedKeys.get(name)
    if (definedKeys.has(name) && known !== place) {
        throw new Error(`Context key '${name}' is defined twice: at ${known ?? "?"} and at ${place ?? "?"}. `
            + `Context values are stored by key name, so the two would share one value: give each its own name `
            + `(a GGHeader or GGCookie takes it as {key: "…"}).`)
    }
    definedKeys.set(name, place)
}

/** `file:line:col` of the first stack frame past the key constructors (this one and its subclasses'), without the
 *  `file://` scheme or the query an HMR reload adds. Reads V8's stack format: elsewhere every key reads as defined
 *  here, so nothing is refused. */
function definitionPlace(): string | undefined {
    const frame = new Error().stack?.split("\n").slice(1).find(line => !/^\s*at (new |registerName |definitionPlace )/.test(line))
    const location = frame?.trim().match(/^at (?:.*? \()?(.*?)\)?$/)?.[1]
    return location?.replace(/^file:\/\//, "").replace(/\?[^:]*(?=:\d+:\d+$)/, "")
}
