import type {GGLocatorKey} from "./GGLocatorKey";
import {GG_ASYNC_STORAGE} from "./GGLocatorStorage";
import {GGLocatorScopeDebug, GGLocatorScopeDebugList} from "./GGLocatorScopeDebug";
import {enumOf, type Values} from "@grest-ts/common";

type ConstructorOf<T> = new (...args: any[]) => T;

/**
 * service-locator pattern for async context cases.
 */
export class GGLocatorScope {

    public readonly name: string
    public readonly serviceName: string
    private readonly parent: GGLocatorScope | undefined
    private readonly values: Map<string, any>
    private readonly registrationStacks: Map<string, string[]>
    private readonly creationStack: string[]

    constructor(name: string, parent?: GGLocatorScope, serviceName?: string) {
        this.name = name
        this.serviceName = serviceName ?? "Unknown";
        this.parent = parent
        this.values = new Map(this.parent?.values ?? []);
        this.registrationStacks = new Map(this.parent?.registrationStacks ?? []);
        this.creationStack = new Error().stack?.split("\n").splice(2) ?? [];
    }

    private _get<T>(name: string): T {
        const value = this.values.get(name);
        if (value === undefined) {
            throw new Error(
                `Service "${name}" not found in async context!\n` +
                `Scope tree: ${this.getScopeDebug().toString()}`
            );
        }
        return value;
    }

    public get<T>(token: GGLocatorKey<T>): T {
        return this._get(token.name)
    }

    public tryGet<T>(token: GGLocatorKey<T>): T | undefined {
        return this.values.get(token.name);
    }

    public getByTokenName<T>(name: string, type: ConstructorOf<T>): T {
        const value = this._get(name)
        if (!(value instanceof type)) {
            throw new Error("Service is not extending expected type! Expected '" + type?.name + "', but got '" + value?.constructor?.name + "' instead.")
        }
        return value as T;
    }

    public set<T>(token: GGLocatorKey<T>, value: T): void {
        if (this.values.has(token.name)) {
            throw new Error(`Scope already has service "${token.name}"!`)
        }
        this.overwrite(token, value)
    }

    public overwrite<T>(token: GGLocatorKey<T>, value: T): void {
        this.values.set(token.name, value);
        this.registrationStacks.set(token.name, new Error().stack?.split("\n").splice(2) ?? []);
    }

    public has<T>(token: GGLocatorKey<T>): boolean {
        return this.values.has(token.name);
    }

    /**
     * Returns all registered key names in this scope.
     * Used by testkit to report available services to test runner.
     */
    public getKeys(): string[] {
        return Array.from(this.values.keys());
    }

    // -----------

    private _lifecycleHandler?: (service: GGLocatorLifecycleCallbacks) => void;

    public setLifecycleOwner(handler: ((service: GGLocatorLifecycleCallbacks) => void) | undefined): void {
        this._lifecycleHandler = handler;
    }

    public setWithLifecycle<T>(token: GGLocatorKey<T>, value: T, lifecycle: GGLocatorLifecycleCallbacks): void {
        if (!this._lifecycleHandler) {
            throw new Error("No lifecycle handler - are you registering outside compose phase?");
        }
        this.set(token, value);
        this._lifecycleHandler(lifecycle);
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

    /**
     * Wraps a function with a async context run() call. Safe for most cases.
     * Consider wrapWithEnter in case you want same context for that function forever.
     */
    public wrapWithRun<T extends (...args: any[]) => any>(fn: T): T {
        return ((...args: any[]) => {
            return this.run(() => {
                return fn(...args)
            })
        }) as T;
    }

    /**
     * Wraps function to ensure this scope is active before each call.
     * Unlike wrapWithRun, doesn't create a new async boundary - just ensures scope is entered.
     * More performant for high-frequency event handlers where scope doesn't change.
     */
    public wrapWithEnter<T extends (...args: any[]) => any>(fn: T): T {
        return ((...args: any[]) => {
            this.ensureEntered()
            return fn(...args)
        }) as T;
    }

    public getScopeDebug(): GGLocatorScopeDebug {
        const debug = new GGLocatorScopeDebug(this.name, this.creationStack);
        this.values.forEach((value, name) => {
            debug.add(name, value, this.registrationStacks.get(name));
        })
        return debug;
    }

    public getScopeDebugFull(list: GGLocatorScopeDebugList = new GGLocatorScopeDebugList()): GGLocatorScopeDebugList {
        if (this.parent) {
            this.parent.getScopeDebugFull(list);
        }
        list.add(this.getScopeDebug())
        return list;
    }

    // -----------

    public branch(name: string, serviceName?: string): GGLocatorScope {
        return new GGLocatorScope(name, this, serviceName);
    }

    public run<R>(fn: () => R): R {
        return GG_ASYNC_STORAGE.run(this, fn);
    }

    public enter() {
        GG_ASYNC_STORAGE.enterWith(this);
        return this;
    }

    public ensureEntered(): void {
        const store = GG_ASYNC_STORAGE.getStore();
        if (store !== this) {
            GG_ASYNC_STORAGE.enterWith(this);
        }
    }

    public reset(): void {
        this.values.clear();
        this.registrationStacks.clear();
        if (!this.parent) return;
        this.parent.values.forEach((value, name) => this.values.set(name, value))
        this.parent.registrationStacks.forEach((value, name) => this.registrationStacks.set(name, value))
    }

}

/**
 * Service initialization order - determines the sequence in which services start and stop.
 * Services with lower values start first and stop last (reverse order for teardown).
 *
 * Example startup order: CONFIG → DATABASE → HTTP → INTL → BUSINESS → PERIODIC_JOBS → SERVICE_DISCOVERY
 */
export const GGLocatorServiceType = enumOf({
    CONFIG: 0,
    DATABASE: 10,
    HTTP: 20,
    INTL: 25,
    BUSINESS: 30,
    PERIODIC_JOBS: 40,
    SERVICE_DISCOVERY: 999,
});
export type GGLocatorServiceType = Values<typeof GGLocatorServiceType>;

/**
 * Service lifecycle callbacks registered with GGServiceRegistry.
 *
 * Services register these during construction (in GGRuntime.compose) to participate
 * in the runtime lifecycle - startup, teardown, and per-request context hooks.
 */
export interface GGLocatorLifecycleCallbacks {
    // Numeric start/stop priority (lower starts first). The named anchors stay visible in editors; `number & {}` keeps the union from collapsing to bare `number` so offsets like CONFIG + 1 are still allowed.
    type: GGLocatorServiceType | (number & {})
    start: () => any | Promise<any>
    teardown?: () => any | Promise<any>
}