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
/** On a @mockable class: the decorated constructor, named like the declared class. */
const MOCKABLE_CLASS = Symbol('GGMockableClass');

/**
 * A function's parameter count (one, or not) and the source after its parameter list, read from its source
 * (comments, strings, defaults and destructuring aware). Mocks see an only argument itself; otherwise the tuple.
 */
function signature(src: string): {oneArgument: boolean, body: string} {
    const bare = /^(async\s+)?[\w$]+\s*=>/.exec(src);
    if (bare) return {oneArgument: true, body: src.slice(bare[0].length - 2)};
    const open = src.indexOf('(');
    if (open < 0) return {oneArgument: false, body: ''};
    let depth = 0, params = 0, rest = false, current = '', quote: string | undefined, i = open + 1;
    const endParam = () => {
        const param = current.trim();
        if (param) {
            params++;
            rest = param.startsWith('...');
        }
        current = '';
    };
    for (; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === '\\') {
            i++;
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
            endParam();
            continue;
        }
        current += ch;
    }
    endParam();
    return {oneArgument: params === 1 && !rest, body: src.slice(i + 1)};
}

/** A body that is only an `__awaiter` call: TypeScript's compiled async, also through tslib and after comments. */
const COMPILED_ASYNC_BODY = /^\s*(?:=>\s*)?\{?\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:return\s+)?(?:\(0,\s*)?(?:[\w$]+\.)?__awaiter\b/;

/**
 * Undefined when `fn` isn't intercepted, else whether it takes one argument.
 * Only async functions are intercepted, so sync methods keep their calling semantics.
 */
function interception(fn: Function): boolean | undefined {
    const src = fn.toString();
    const {oneArgument, body} = signature(src);
    const isAsync = fn.constructor.name === 'AsyncFunction' || src.trimStart().startsWith('async ') || COMPILED_ASYNC_BODY.test(body);
    return isAsync ? oneArgument : undefined;
}

/**
 * Wrap an async method or field to intercept calls in test mode.
 * Only async ones are wrapped - sync methods are not mockable to preserve calling semantics.
 * @TODO XXAsyncMethodIssue
 * @TODO Right now mocks go back to test to see "whats up", but we should actually sync mocks info to the service before the call, so even for sync methods we can resolve the mock data.
 * @TODO This has a drawback of losing "central brain" control though, as each mock is no instance bound.
 */
function intercept(className: string, methodName: string, original: Function, oneArgument: boolean): Function {
    const wrapped = async function (this: any, ...args: any[]) {
        const ctx = mockableContextStorage.getStore();

        // Not in test mode - call original method directly (zero overhead path)
        if (!ctx) {
            return original.apply(this, args);
        }

        const result = await ctx.sendCall(className, methodName, oneArgument ? args[0] : args);
        if (result !== ctx.CALL_THROUGH) {
            return result;
        }
        // Spy mode - call the real method and report its result
        const realResult = await original.apply(this, args);
        await ctx.sendSpyResult(className, methodName, realResult);
        return realResult;
    };
    (wrapped as any)[MOCKABLE_WRAPPED] = className;
    return wrapped;
}

/**
 * The class name mocks of `cls`'s `methodName` are keyed under. Throws when `@mockable` can't intercept it.
 * A name the prototype doesn't have may be a class field, which only an instance shows, so it is accepted.
 */
export function mockableClassName(cls: Function, methodName: string): string {
    const method = cls.prototype?.[methodName];
    if (method?.[MOCKABLE_WRAPPED]) return method[MOCKABLE_WRAPPED];
    const className: string | undefined = (cls as any)[MOCKABLE_CLASS]?.name;
    if (!className) {
        throw new Error(`${cls.name}.${methodName} is not mockable: ${cls.name} has no @mockable.`);
    }
    if (typeof method === 'function') {
        throw new Error(`${cls.name}.${methodName} is not mockable: @mockable intercepts async methods only.`);
    }
    return className;
}

// ============================================================================
// The @mockable decorator
// ============================================================================

/**
 * Decorator to mark a class as mockable in tests.
 * Its async methods and async function fields (`foo = async () => …`) are interceptable via mockOf() or spyOn().
 * Fields are wrapped when an instance is constructed in a test, so the decorated class is a subclass of the declared
 * one; fields a subclass of it declares are not wrapped unless that subclass is @mockable too.
 *
 * In production (when not running tests), this decorator has minimal overhead - a method wrapper immediately calls
 * through to the original, and fields are left as they are.
 *
 * @example
 * ```typescript
 * import {mockable} from "@grest-ts/testkit-runtime";
 *
 * @mockable
 * export class AddressResolverService {
 *     resolveAddress = async (address: string): Promise<LatLng> => { ... }
 * }
 *
 * // In tests:
 * .with(mockOf(AddressResolverService).resolveAddress
 *     .toEqual("123 Main St")
 *     .andReturn({lat: 40.7, lng: -74.0}))
 * ```
 */
export function mockable<T extends { new(...args: any[]): {} }>(target: T): T {
    const className = target.name;
    for (const key of Object.getOwnPropertyNames(target.prototype)) {
        const method = Object.getOwnPropertyDescriptor(target.prototype, key)?.value;
        const oneArgument = key === 'constructor' || typeof method !== 'function' || method[MOCKABLE_WRAPPED] ? undefined : interception(method);
        if (oneArgument !== undefined) target.prototype[key] = intercept(className, key, method, oneArgument);
    }

    const mocked = class extends target {
        constructor(...args: any[]) {
            super(...args);
            // Fields are wrapped only for an instance made in a test, and by the most-derived @mockable class, so
            // they are keyed under the class mockOf() is given.
            if (!mockableContextStorage.getStore() || (new.target as any)[MOCKABLE_CLASS] !== mocked) return;
            for (const key of Object.keys(this)) {
                const descriptor = Object.getOwnPropertyDescriptor(this, key)!;
                const value = descriptor.value;
                if (typeof value !== 'function' || !descriptor.writable || value[MOCKABLE_WRAPPED]) continue;
                const oneArgument = interception(value);
                if (oneArgument !== undefined) (this as any)[key] = intercept(className, key, value, oneArgument);
            }
        }
    };
    Object.defineProperty(mocked, 'name', {value: className, configurable: true});
    Object.defineProperty(mocked, MOCKABLE_CLASS, {value: mocked});
    return mocked;
}
