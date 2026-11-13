import {RuntimeConstructor, Selector, SelectorExtensions, ObjectResult, StartResult, RuntimeInput} from "./RuntimeSelector";
import {GGTestRuntime} from "../GGTestRuntime";
import type {GGTestRunner} from "../GGTestRunner";

/**
 * Internal implementation class for Selector.
 * Works with GGTestRuntime instances directly.
 */
export class GGTestSelector<T extends RuntimeConstructor[]> {

    private static readonly extensions = new Map<string, typeof GGTestSelectorExtension>();

    public readonly runtimes: GGTestRuntime[];
    private readonly extensionCache = new Map<string, unknown>();

    constructor(runtimes: GGTestRuntime[]) {
        this.runtimes = runtimes;
    }

    public get length(): number {
        return this.runtimes.length;
    }

    public static addExtension(factory: typeof GGTestSelectorExtension & { PROPERTY_NAME: string }): void {
        if (this.extensions.has(factory.PROPERTY_NAME)) {
            throw new Error("Extension with name '" + factory.PROPERTY_NAME + "' is already registered!")
        }
        this.extensions.set(factory.PROPERTY_NAME, factory);
    }

    public static hasExtension(name: string): boolean {
        return this.extensions.has(name);
    }

    public getExtension<K extends keyof SelectorExtensions<T>>(name: K): SelectorExtensions<T>[K] {
        const cached = this.extensionCache.get(name as string);
        if (cached !== undefined) {
            return cached as SelectorExtensions<T>[K];
        }

        const extension = GGTestSelector.extensions.get(name);
        if (!extension) {
            throw new Error(`Extension '${String(name)}' is not registered. ` +
                `Make sure the module providing this extension is imported.`);
        }

        const extensionInstance = new extension(this.runtimes);
        this.extensionCache.set(name as string, extensionInstance);
        return extensionInstance as unknown as SelectorExtensions<T>[K];
    }

    /**
     * Stop all runtimes in this selector.
     */
    public async stop(): Promise<void> {
        for (const runtime of this.runtimes) {
            await runtime.stop();
        }
    }

    /**
     * Shutdown all runtimes in this selector.
     */
    public async shutdown(): Promise<void> {
        for (const runtime of this.runtimes) {
            await runtime.shutdown();
        }
    }
}

export class GGTestSelectorExtension {

    protected readonly runner: GGTestRunner
    protected readonly runtimes: GGTestRuntime[]

    constructor(runtimes: GGTestRuntime[]) {
        this.runtimes = runtimes
        this.runner = this.runtimes[0]?.runner
    }

    protected async forEachParallel(callback: (runtime: GGTestRuntime) => Promise<void>): Promise<void> {
        const results = await Promise.allSettled(
            this.runtimes.map(runtime => callback(runtime))
        );
        const errors = results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map(r => r.reason);

        if (errors.length > 0) {
            throw new AggregateError(errors, `${errors.length} runtime(s) failed`);
        }
    }
}

/**
 * Create a proxied Selector that supports:
 * - Indexed access: selector[0]
 * - Extension access: selector.config, selector.logs
 * - Lifecycle methods: selector.stop(), selector.shutdown()
 * - Standard properties: selector.runtimes, selector.length
 */
export function createSelector<T extends RuntimeConstructor[]>(runtimes: GGTestRuntime[]): Selector<T> {
    const impl = new GGTestSelector<T>(runtimes);

    return new Proxy(impl as unknown as Selector<T>, {
        get(target, prop) {
            const implTarget = target as unknown as GGTestSelector<T>;

            // Handle numeric index access: selector[0]
            if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                const index = parseInt(prop, 10);
                if (index >= 0 && index < implTarget.runtimes.length) {
                    return createSelector([implTarget.runtimes[index]]);
                }
                return undefined;
            }

            // Handle extension access: selector.config, selector.logs, etc.
            if (typeof prop === 'string' && GGTestSelector.hasExtension(prop)) {
                return implTarget.getExtension(prop as keyof SelectorExtensions<T>);
            }

            // Handle methods and properties from impl
            return Reflect.get(implTarget, prop);
        }
    }) as Selector<T>;
}

// ============================================================================
// Factory functions for different input shapes
// ============================================================================

/**
 * Create result based on input shape.
 * - Single runtime → Selector
 * - Array of runtimes → Selector
 * - Object → ObjectResult with named selectors
 */
export function createStartResult<T extends RuntimeInput>(
    input: T,
    runtimes: GGTestRuntime[]
): StartResult<T> {
    // Object input: { main: MainRuntime, sub: SubRuntime }
    if (isObjectInput(input)) {
        return createObjectResult(input, runtimes) as StartResult<T>;
    }

    if (runtimes.length > 1) {
        runtimes.forEach((runtime, index) => runtime.label = `${runtime.name}[${index}]`);
    }
    return createSelector(runtimes) as StartResult<T>;
}

/**
 * Check if input is an object (not a constructor or array).
 */
function isObjectInput(input: RuntimeInput): input is Record<string, RuntimeConstructor | RuntimeConstructor[]> {
    return typeof input === 'object' && !Array.isArray(input) && !('NAME' in input);
}

/**
 * Create ObjectResult for object input.
 */
function createObjectResult<T extends Record<string, RuntimeConstructor | RuntimeConstructor[]>>(
    input: T,
    runtimes: GGTestRuntime[]
): ObjectResult<T> {
    const result: Record<string, Selector<any>> = {};

    // Same order as GGTest.extractConstructors created them in.
    let next = 0;
    for (const [key, value] of Object.entries(input)) {
        const keyRuntimes = runtimes.slice(next, next += Array.isArray(value) ? value.length : 1);
        keyRuntimes.forEach((runtime, index) => runtime.label = Array.isArray(value) ? `${key}[${index}]` : key);
        result[key] = createSelector(keyRuntimes);
    }

    // Add stop/shutdown that affects all runtimes
    (result as any).stop = async () => {
        for (const runtime of runtimes) {
            await runtime.stop();
        }
    };

    (result as any).shutdown = async () => {
        for (const runtime of runtimes) {
            await runtime.shutdown();
        }
    };

    return result as ObjectResult<T>;
}

export function singleRuntime(selector: {readonly runtimes: GGTestRuntime[]}): GGTestRuntime {
    const runtimes = selector?.runtimes;
    if (!Array.isArray(runtimes)) {
        throw new Error(".on() takes a runtime selector, e.g. the result of GGTest.startWorker(MyRuntime) or one of its keys or indexes.");
    }
    if (runtimes.length !== 1) {
        throw new Error(`.on() takes exactly one runtime, but this selector holds ${runtimes.length}` +
            (runtimes.length ? ` (${runtimes.map(r => r.label).join(", ")}). Pick one by index or key.` : "."));
    }
    return runtimes[0];
}
