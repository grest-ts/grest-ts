/**
 * Minimal runtime for @mockable decorator.
 * This file has NO dependencies on testkit internals and is safe for production bundles.
 *
 * The decorator wraps methods but only activates mock/spy behavior when running in test mode.
 * In production, methods are called directly with zero overhead beyond the wrapper.
 */

import {AsyncLocalStorage} from "async_hooks";

// ============================================================================
// Test context interface - implemented by testkit's GGTestRuntimeWorker
// ============================================================================

export interface MockableTestContext {
    /**
     * Send a mockable call to the test runner.
     * Returns mock data, or CALL_THROUGH symbol for spy mode.
     */
    sendCall(className: string, methodName: string, callArgs: any): Promise<any>;

    /**
     * Report the result of a spy call back to the test runner.
     */
    sendSpyResult(className: string, methodName: string, callResult: any): Promise<void>;

    /**
     * Sentinel value indicating spy mode (call the real method).
     */
    readonly CALL_THROUGH: string;
}

// ============================================================================
// Context storage - set by testkit when running tests
// ============================================================================

const mockableContextStorage = new AsyncLocalStorage<MockableTestContext>();

/**
 * Run code within a mockable test context.
 * Called by testkit's GGTestRuntimeWorker to enable mock/spy behavior.
 * @internal
 */
export function runWithMockableContext<T>(ctx: MockableTestContext, fn: () => T): T {
    return mockableContextStorage.run(ctx, fn);
}

// ============================================================================
// Helper functions
// ============================================================================

const MOCKABLE_WRAPPED = Symbol('GGMockableWrapped');

interface ParamInfo {
    /** Undefined for a destructured parameter. */
    name: string | undefined;
    rest: boolean;
}

/** Top-level parameters of a function, read from its source; destructuring, defaults and nesting aware. */
function parseParams(fn: Function): ParamInfo[] {
    const src = fn.toString();
    const open = src.indexOf('(');
    if (open < 0) return [];
    const parts: string[] = [];
    let depth = 0, current = '', quote: string | undefined;
    for (let i = open + 1; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            current += ch;
            if (ch === '\\') current += src[++i];
            else if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === '/' && (src[i + 1] === '*' || src[i + 1] === '/')) {
            const end = src[i + 1] === '*' ? src.indexOf('*/', i + 2) + 1 : src.indexOf('\n', i);
            i = end > 0 ? end : src.length;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') {
            if (depth === 0) break;
            depth--;
        } else if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
            const rest = p.startsWith('...');
            const name = p.replace(/^\.\.\./, '').split('=')[0].trim();
            return {name: /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined, rest};
        });
}

/**
 * What mock matchers and `andReturn` callbacks see, matching `mockOf`'s types:
 * a single object argument as itself, anything else keyed by parameter name.
 */
function argsToMockInput(args: any[], params: ParamInfo[], sole: boolean): any {
    const single = args[0];
    const isObject = (typeof single === 'object' && single !== null) || typeof single === 'function';
    if (sole && (isObject || params[0].name === undefined)) {
        return single;
    }
    const result: Record<string, any> = {};
    params.forEach((param, i) => {
        result[param.name ?? `arg${i}`] = param.rest ? args.slice(i) : args[i];
    });
    return result;
}

export interface MockableMethodInfo {
    /** The class name the method's calls are intercepted under. */
    className: string;
    /** A destructured parameter among several: mocks can't key its arguments by name. */
    unnamedParams: boolean;
}

/** How `@mockable` intercepts `cls.prototype[methodName]`, or undefined when it doesn't. */
export function mockableMethod(cls: Function, methodName: string): MockableMethodInfo | undefined {
    return cls.prototype?.[methodName]?.[MOCKABLE_WRAPPED];
}

/**
 * Check if a function is async (returns a Promise).
 * @deprected - having this is bad, we should not check it like this!
 * @TODO Existance of this is bad!
 */
function isAsyncFunction(fn: Function): boolean {
    return fn.constructor.name === 'AsyncFunction' ||
        fn.toString().includes('__awaiter') || // Compiled TypeScript async
        fn.toString().trimStart().startsWith('async ');
}

/**
 * Wrap a method to intercept calls in test mode.
 * Only wraps async methods - sync methods are not mockable to preserve calling semantics.
 */
function wrapMethod(cls: any, methodName: string): void {
    // Skip if already wrapped
    if (cls.prototype[methodName]?.[MOCKABLE_WRAPPED]) {
        return;
    }

    const originalMethod = cls.prototype[methodName];

    // Only wrap async methods - sync helper methods shouldn't be intercepted
    // because making them async would break calling code that doesn't await them
    // @TODO XXAsyncMethodIssue
    // @TODO Having this is literally bad, we need to change how mock logic works.
    // @TODO Right now mocks go back to test to see "whats up", but we should actually sync mocks info to the service before the call, so even for sync methods we can resolve the mock data.
    // @TODO This has a drawback of losing "central brain" control though, as each mock is no instance bound.
    // @TODO This whole idea needs thinking
    if (!isAsyncFunction(originalMethod)) {
        return;
    }

    const params = parseParams(originalMethod);
    const sole = params.length === 1 && !params[0].rest;
    const unnamedParams = !sole && params.some(p => p.name === undefined);

    const wrappedMethod = async function (this: any, ...args: any[]) {
        const ctx = mockableContextStorage.getStore();

        // Not in test mode - call original method directly (zero overhead path)
        if (!ctx) {
            return originalMethod.apply(this, args);
        }

        // In test mode - go through mock/spy system
        const callArgs = argsToMockInput(args, params, sole);
        const result = await ctx.sendCall(cls.name, methodName, callArgs);

        if (result === ctx.CALL_THROUGH) {
            // Spy mode - call the real method
            const realResult = await originalMethod.apply(this, args);

            // Report result back for validation
            await ctx.sendSpyResult(cls.name, methodName, realResult);

            return realResult;
        } else {
            // Mock mode - return the mock data
            return result;
        }
    };

    // Mark as wrapped and assign to prototype
    (wrappedMethod as any)[MOCKABLE_WRAPPED] = {className: cls.name, unnamedParams} satisfies MockableMethodInfo;
    cls.prototype[methodName] = wrappedMethod;
}

// ============================================================================
// The @mockable decorator
// ============================================================================

/**
 * Decorator to mark a class as mockable in tests.
 * All public async methods will be interceptable via mockBy() or spyOn().
 *
 * In production (when not running tests), this decorator has minimal overhead -
 * methods are wrapped but the wrapper immediately calls through to the original.
 *
 * @example
 * ```typescript
 * import {mockable} from "@grest-ts/testkit/mockable";
 *
 * @mockable
 * export class AddressResolverService {
 *     async resolveAddress(address: string): Promise<LatLng> { ... }
 * }
 *
 * // In tests:
 * .with(mockBy(AddressResolverService).resolveAddress
 *     .toEqual({address: "123 Main St"})
 *     .andReturn({lat: 40.7, lng: -74.0}))
 * ```
 */
export function mockable<T extends { new(...args: any[]): {} }>(target: T): T {
    // Get all methods from prototype
    for (const key of Object.getOwnPropertyNames(target.prototype)) {
        if (key === 'constructor') continue;

        const descriptor = Object.getOwnPropertyDescriptor(target.prototype, key);
        if (descriptor && typeof descriptor.value === 'function') {
            wrapMethod(target, key);
        }
    }

    return target;
}
