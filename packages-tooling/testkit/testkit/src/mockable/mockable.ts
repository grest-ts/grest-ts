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

// ============================================================================
// Type helpers for mockBy/spyOn
// ============================================================================

/**
 * Type for mock access - maps class methods to GGMockWith
 */
type MockAccess<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
        ? GGMockWith<A extends [infer Single] ? (Single extends object ? Single : Record<string, Single>) : Record<string, any>, Awaited<R>, never>
        : never
};

/**
 * Type for spy access - maps class methods to GGSpyWith
 */
type SpyAccess<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
        ? GGSpyWith<A extends [infer Single] ? (Single extends object ? Single : Record<string, Single>) : Record<string, any>, Awaited<R>, never>
        : never
};

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
        get(_, methodName: string) {
            return new GGMockWith(GGMockableInterceptor, {className: cls.name, methodName})
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
        get(_, methodName: string) {
            return new GGSpyWith(GGMockableInterceptor, {className: cls.name, methodName})
        }
    });
}
