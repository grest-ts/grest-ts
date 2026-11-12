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
import {mockableClassName} from "@grest-ts/testkit-runtime";
import type {ANY_ERROR} from "@grest-ts/schema";

// ============================================================================
// Type helpers for mockBy/spyOn
// ============================================================================

/** A single object argument as itself; anything else keyed by parameter name. */
type MockInput<A extends any[]> = A extends [infer Single]
    ? (Single extends object ? Single : Record<string, Single>)
    : Record<string, any>;

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

function interceptorConfig(cls: Function, methodName: string | symbol): {className: string, methodName: string} {
    const className = typeof methodName === "string" ? mockableClassName(cls, methodName) : undefined;
    if (!className) {
        throw new Error(
            `${cls.name}.${String(methodName)} is not mockable. @mockable intercepts only async methods declared in the body of a decorated class: ` +
            `not class fields (\`${String(methodName)} = async () => …\`), sync methods, or methods of a class without @mockable.`
        );
    }
    return {className, methodName: methodName as string};
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
    return new Proxy({} as any, {
        get(_, methodName) {
            return new GGMockWith(GGMockableInterceptor, interceptorConfig(cls, methodName))
        }
    });
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
    return new Proxy({} as any, {
        get(_, methodName) {
            return new GGSpyWith(GGMockableInterceptor, interceptorConfig(cls, methodName))
        }
    });
}
