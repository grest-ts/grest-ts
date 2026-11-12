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
import {mockableMethod} from "@grest-ts/testkit-runtime";
import type {ANY_ERROR} from "@grest-ts/schema";

// ============================================================================
// Type helpers for mockBy/spyOn
// ============================================================================

/** A single object argument as itself; anything else keyed by parameter name. */
type MockInput<A extends any[]> = A extends []
    ? Record<string, any>
    : A extends [(infer Single)?]
        ? SingleInput<[] extends A ? Single | undefined : Single>
        : Record<string, any>;

type SingleInput<Single> = Single extends object ? Single : Record<string, Single>;

type MockAccess<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
        ? GGMockWith<MockInput<A>, Awaited<R>, ANY_ERROR>
        : never
};

type SpyAccess<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
        ? GGSpyWith<MockInput<A>, Awaited<R>, never>
        : never
};

/** Read by `await` and by inspection (pretty-format, JSON), so not taken for a method when the class has none by that name. */
const PROBED_KEYS = new Set(["then", "toJSON", "asymmetricMatch", "$$typeof", "nodeType"]);

function interceptorConfig(cls: Function, methodName: string): {className: string, methodName: string} | undefined {
    const method = mockableMethod(cls, methodName);
    if (!method && PROBED_KEYS.has(methodName)) return undefined;
    if (!method) {
        throw new Error(
            `${cls.name}.${methodName} is not mockable. @mockable intercepts only async methods declared in the body of a decorated class: ` +
            `not class fields (\`${methodName} = async () => …\`), sync methods, or methods of a class without @mockable.`
        );
    }
    if (method.unnamedParams) {
        throw new Error(
            `${cls.name}.${methodName} can't be mocked: mocks key its arguments by parameter name, and a destructured parameter among several has none. ` +
            `Take it whole (\`(a, input: {x, y})\`) and destructure it in the body.`
        );
    }
    return {className: method.className, methodName};
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
 *     .toEqual({address: "123 Main St"})
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
 *     .toEqual({address: "123 Main St"})
 *     .responseToMatchObject({lat: 40.7}))
 * ```
 */
export function spyOn<T>(cls: new (...args: any[]) => T): SpyAccess<T> {
    return accessProxy(cls, config => new GGSpyWith(GGMockableInterceptor, config));
}
