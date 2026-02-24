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
    sendCall(className: string, methodName: string, callArgs: Record<string, any>): Promise<any>;

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

/**
 * Extract parameter names from a function.
 * Falls back to arg0, arg1, etc. if parsing fails.
 */
function getParamNames(fn: Function): string[] {
    const fnStr = fn.toString();
    // Match function parameters: function(a, b, c) or (a, b, c) =>
    const match = fnStr.match(/(?:function\s*\w*\s*\(|\()\s*([^)]*)\)/);
    if (!match || !match[1]) return [];

    return match[1]
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => {
            // Handle destructuring, default values, type annotations
            // Take just the parameter name before : or =
            const name = p.split(/[=:]/)[0].trim();
            // Remove ... for rest params
            return name.replace(/^\.\.\./, '');
        });
}

/**
 * Convert positional arguments to a named object.
 */
function argsToObject(args: any[], paramNames: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (let i = 0; i < args.length; i++) {
        result[paramNames[i] || `arg${i}`] = args[i];
    }
    return result;
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

    const paramNames = getParamNames(originalMethod);

    const wrappedMethod = async function (this: any, ...args: any[]) {
        const ctx = mockableContextStorage.getStore();

        // Not in test mode - call original method directly (zero overhead path)
        if (!ctx) {
            return originalMethod.apply(this, args);
        }

        // In test mode - go through mock/spy system
        const callArgs = argsToObject(args, paramNames);
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
    (wrappedMethod as any)[MOCKABLE_WRAPPED] = true;
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
