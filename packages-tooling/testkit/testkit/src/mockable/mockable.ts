/**
 * Mockable decorator and test helpers.
 *
 * The @mockable decorator is re-exported from mockable-runtime.ts for production use.
 * mockBy() and spyOn() are test-only utilities that require the full testkit.
 */

// Test-only imports - these pull in testkit infrastructure
import {GGMockableInterceptor} from "./GGMockableInterceptor";
import {GGMockWith} from "../testers/GGMockWith";
import {GGSpyWith} from "../testers/GGSpyWith";
import {mockableClassName, type MockableTestContext, setMockableContextFallback} from "@grest-ts/testkit-runtime";
import {type ANY_ERROR, ERROR} from "@grest-ts/schema";
import {GG_TEST_RUNNER} from "../GGTestRunner";
import {GG_TEST_RUNTIME_WORKER} from "../GGTestRuntimeWorker";
import {CALL_THROUGH, GGMockableInterceptorsServer} from "./GGMockableInterceptorsServer";

// A call outside a runtime's own async context: in a runtime's scope entered from the test, it goes through that
// runtime's worker as the runtime's own calls do; in a test body, straight to the runner's interceptors.
setMockableContextFallback((): MockableTestContext | undefined => {
    const worker = GG_TEST_RUNTIME_WORKER.tryGet();
    if (worker) return worker.mockableContext;
    const runner = GG_TEST_RUNNER.tryGet();
    if (!runner) return undefined;
    const server = runner.getExtensionInstance(GGMockableInterceptorsServer);
    return {
        CALL_THROUGH,
        sendCall: (className, methodName, callArgs) => server.call({className, methodName, callArgs}),
        sendSpyResult: (className, methodName, callResult) => server.spyResult({className, methodName, callResult}),
        sendSpyError: (className, methodName, error) => server.spyResult({className, methodName, callError: ERROR.fromUnknown(error).toJSON()}),
    };
});

// ============================================================================
// Type helpers for mockBy/spyOn
// ============================================================================

/** What a mock's matchers and `andReturn` callback get: a method's only argument itself, otherwise its arguments as a tuple. */
type MockInput<A extends any[]> = A extends []
    ? []
    : A extends [infer Only]
        ? Only
        : A extends [(infer Only)?]
            ? Only | undefined
            : A;

type MockAccess<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
        ? GGMockWith<MockInput<A>, Awaited<R>, ANY_ERROR>
        : never
};

type SpyAccess<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
        ? GGSpyWith<MockInput<A>, Awaited<R>, ANY_ERROR>
        : never
};

/** Read by `await` and by inspection (pretty-format, JSON): a tester only for an async method of that name, else undefined. */
const PROBED_KEYS = new Set(["then", "toJSON", "asymmetricMatch", "$$typeof", "nodeType"]);

function interceptorConfig(cls: Function, methodName: string): {className: string, methodName: string} | undefined {
    if (PROBED_KEYS.has(methodName) && typeof cls.prototype?.[methodName] !== "function") return undefined;
    try {
        return {className: mockableClassName(cls, methodName), methodName};
    } catch (error) {
        if (PROBED_KEYS.has(methodName)) return undefined;
        throw error;
    }
}

function accessProxy(cls: Function, tester: (config: {className: string, methodName: string}) => unknown): any {
    return new Proxy({}, {
        get: (_, key) => {
            const config = typeof key === "string" ? interceptorConfig(cls, key) : undefined;
            return config && tester(config);
        }
    });
}

/**
 * Get mock access for a @mockable class.
 * Use this to create mock expectations in tests.
 *
 * @example
 * ```typescript
 * .with(mockOf(AddressResolverService).resolveAddress
 *     .toEqual("123 Main St")
 *     .andReturn({lat: 40.7, lng: -74.0}))
 * ```
 */
export function mockOf<T>(cls: new (...args: any[]) => T): MockAccess<T> {
    return accessProxy(cls, config => new GGMockWith(GGMockableInterceptor, config));
}

/**
 * Get spy access for a @mockable class.
 * Use this to create spy expectations in tests - the real method will be called.
 *
 * @example
 * ```typescript
 * .with(spyOn(AddressResolverService).resolveAddress
 *     .toEqual("123 Main St")
 *     .responseToMatchObject({lat: 40.7}))
 * ```
 */
export function spyOn<T>(cls: new (...args: any[]) => T): SpyAccess<T> {
    return accessProxy(cls, config => new GGSpyWith(GGMockableInterceptor, config));
}
