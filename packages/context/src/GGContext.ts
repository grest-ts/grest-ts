import type {GGContextKey} from "./GGContextKey";
import {GG_CONTEXT_STORAGE} from "./GGContextStore";

export class GGContext {

    public readonly name: string
    private readonly parent: GGContext | undefined
    private readonly values: Map<string, any>
    private readonly strict: boolean

    constructor(name: string, parent?: GGContext, strict: boolean = false) {
        this.name = name
        this.parent = parent
        this.values = new Map();
        this.strict = strict
    }

    public get<T>(token: GGContextKey<T>): T {
        return this.values.get(token.name) ?? this.parent?.get(token);
    }

    public set<T>(token: GGContextKey<T>, value: T): this {
        if (this.strict && !token.mutable && this.values.has(token.name)) {
            throw new Error(`Context key '${token.name}' is already set in this request scope and cannot be re-set. Pass {mutable: true} to GGContextKey if it must be re-set (e.g. trace).`)
        }
        this.values.set(token.name, value);
        return this;
    }

    public has<T>(token: GGContextKey<T>): boolean {
        return this.values.has(token.name) || (this.parent?.has(token) ?? false);
    }

    public delete<T>(token: GGContextKey<T>): void {
        this.values.delete(token.name)
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
    }

}
