import type {GGContextKey} from "./GGContextKey";
import {GG_CONTEXT_STORAGE} from "./GGContextStore";

export class GGContext {

    public readonly name: string
    private readonly parent: GGContext | undefined
    private readonly values: Map<string, any>
    private readonly strict: boolean
    /** Keys set here in a strict context, kept through `delete`, so a delete can't open the way to a second set. */
    private readonly setOnce = new Set<string>()
    private sealed = false

    /** `strict`: a key that isn't `mutable` can be set once in this context. Only a root chooses; a child is strict when
     *  its parent is. Units of work are strict roots; a long-lived client context that updates its values (a refreshed
     *  token, a switched locale) is a non-strict one. */
    constructor(name: string, parent?: GGContext)
    constructor(name: string, parent: undefined, options: {strict: boolean})
    constructor(name: string, parent?: GGContext, options?: {strict: boolean}) {
        this.name = name
        this.parent = parent
        this.values = new Map();
        this.strict = parent ? parent.strict : options?.strict ?? false
    }

    public get<T>(token: GGContextKey<T>): T {
        return this.values.get(token.name) ?? this.parent?.get(token);
    }

    public set<T>(token: GGContextKey<T>, value: T): this {
        this.assertNotSealed(token)
        if (this.strict && !token.mutable) {
            if (this.setOnce.has(token.name)) {
                throw new Error(`Context key '${token.name}' was already set in context '${this.name}' and can't be set again there, even after a delete. `
                    + `Set it in a child context to scope another value to part of the work, or pass {mutable: true} to GGContextKey if it must change (like the trace).`)
            }
            this.setOnce.add(token.name)
        }
        this.values.set(token.name, value);
        return this;
    }

    public has<T>(token: GGContextKey<T>): boolean {
        return this.values.has(token.name) || (this.parent?.has(token) ?? false);
    }

    public delete<T>(token: GGContextKey<T>): void {
        this.assertNotSealed(token)
        this.values.delete(token.name)
    }

    /** From now on `set`/`delete` throw. A runtime seals its root context once it runs: everything that ran in it, its
     *  children see, so a value set there later would leak into every request after it. */
    public seal(): this {
        this.sealed = true
        return this
    }

    private assertNotSealed<T>(token: GGContextKey<T>): void {
        if (this.sealed) {
            throw new Error(`Context '${this.name}' is sealed, so '${token.name}' can't be set on it: this code runs outside any `
                + `request, job or timer. Run it as a unit of work of its own (runInFreshContext from @grest-ts/trace).`)
        }
    }

    // -----------

    public setImmediate<R>(fn: () => R): NodeJS.Immediate {
        return setImmediate(() => this.run(fn))
    }

    public setTimeout<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        return setTimeout(() => this.run(fn), timeout)
    }

    public setInterval<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        return setInterval(() => this.run(fn), timeout)
    }

    // -----------

    public run<R>(fn: () => R): R {
        return GG_CONTEXT_STORAGE.run(this, fn);
    }

    public reset(): void {
        this.values.clear();
        this.setOnce.clear();
    }

}
