/**
 * Unified callOn function for invoking methods on runtime instances.
 *
 * Works with:
 * - @testable classes: Direct service invocation via IPC
 * - GGLocatorKey: Direct instance lookup via IPC
 * - GGContractClass: Contract implementation lookup via IPC
 * - Contract holders (HTTP APIs, etc.): Delegated to their own factory
 *
 * @example
 * // Call @testable service
 * await callOn(MyService).doSomething("hello")
 *
 * // Call HTTP API (goes through HTTP transport)
 * await callOn(ChainApi).quickWeatherCheck({city: "NYC"})
 *
 * // Call contract directly (skips HTTP, uses IPC)
 * await callOn(ChainApiContract).quickWeatherCheck({city: "NYC"})
 *
 * // With context
 * await callOn(MyService, ctx).doSomething("hello")
 */

import {GGLocatorKey} from "@grest-ts/locator";
import {GGTestActionForLocatorOnCall} from "./GGTestActionForLocatorOnCall";
import {LOCATOR_KEY_PREFIX_FOR_TESTABLE} from "@grest-ts/testkit-runtime";
import {GGContractApiDefinition, GGContractClass, GGContractMethod} from "@grest-ts/schema";
import {GGContext} from "@grest-ts/context";
import {LOCATOR_KEY_PREFIX_FOR_CONTRACT} from "./GGContractClass.implement";
import type {GGTestRuntime} from "../GGTestRuntime";

// ============================================================================
// Factory symbol for protocol-specific callOn support
// ============================================================================

/**
 * Symbol used by contract holders (HTTP APIs, WebSocket APIs, etc.) to provide
 * their own callOn proxy. This allows protocols to control how calls are made
 * without callOn needing to know about specific protocols.
 *
 * The factory can return anything - there's no constraint on the return type.
 * Each protocol fully controls what methods and types are available.
 */
export const CALL_ON_FACTORY = Symbol.for("gg:callOnFactory");

/**
 * Marker interface for targets that provide their own callOn proxy.
 * The factory can return any type - protocols have full control.
 */
export interface GGCallOnFactory {
    [CALL_ON_FACTORY](ctx?: GGContext): unknown;
}

// ============================================================================
// Type definitions
// ============================================================================

/**
 * Maps a class's async methods to GGLocatorLookupTestAction calls.
 * Used for @testable classes and GGLocatorKey lookups.
 */
export type LocatorLookupAccess<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
        ? (...args: A) => GGTestActionForLocatorOnCall<R>
        : never
};

/**
 * Maps contract methods to GGLocatorLookupTestAction calls.
 * Used for direct GGContractClass lookups via IPC.
 */
export type ContractLocatorAccess<TContract> = {
    [K in keyof TContract]: TContract[K] extends GGContractMethod<infer Input, infer Output>
        ? Input extends undefined ? () => GGTestActionForLocatorOnCall<Output> : (data: Input) => GGTestActionForLocatorOnCall<Output>
        : never
};

export type GGTestCallOnCollection<T> = { [K in keyof T]: GGTestCallOn<T[K]> }

/**
 * Resolves the return type for callOn(target):
 * - Factory targets → extract factory's return type (protocol controls everything)
 * - GGContractClass → ContractLocatorAccess (IPC)
 * - Constructor/GGLocatorKey → LocatorLookupAccess (IPC)
 * - Plain objects → recurse into properties
 */
export type GGTestCallOn<T> =
    T extends { [CALL_ON_FACTORY]: (ctx?: GGContext) => infer R } ? R
        : T extends GGContractClass<infer TContract> ? ContractLocatorAccess<TContract>
            : T extends GGLocatorKey<infer Instance> ? LocatorLookupAccess<Instance>
                : T extends new (...args: any[]) => infer Instance ? LocatorLookupAccess<Instance>
                    : T extends object ? { [K in keyof T]: GGTestCallOn<T[K]> }
                        : never;

// ============================================================================
// The callOn function
// ============================================================================

/**
 * Check if target implements the CALL_ON_FACTORY interface.
 */
function hasCallOnFactory(target: unknown): target is GGCallOnFactory {
    return target != null && typeof (target as any)[CALL_ON_FACTORY] === 'function';
}

/**
 * Check if target is a simple class (constructor function).
 */
function isSimpleClass(value: unknown): value is new (...args: any[]) => any {
    return typeof value === 'function' && value.prototype !== undefined && value.prototype.constructor === value;
}

/**
 * Invoke methods on runtime instances via a unified interface.
 *
 * Resolution order:
 * 1. Factory symbol (HTTP APIs, WebSocket APIs provide their own)
 * 2. GGContractClass → IPC lookup via @contract: prefix
 * 3. GGLocatorKey → IPC lookup via key name
 * 4. Simple class → IPC lookup via @testable: prefix
 *
 * @example
 * await callOn(MyService, ctx).doSomething("hello")
 * await callOn(ChainApi, ctx).quickWeatherCheck({city: "NYC"})
 * await callOn(ChainApiContract, ctx).quickWeatherCheck({city: "NYC"})
 */
export function callOn<T extends GGCallOnFactory>(target: T, ctx?: GGContext): GGTestCallOn<T>;
export function callOn<T extends GGContractApiDefinition>(target: GGContractClass<T>, ctx?: GGContext): ContractLocatorAccess<T>;
export function callOn<T>(target: GGLocatorKey<T>, ctx?: GGContext): LocatorLookupAccess<T>;
export function callOn<T extends new (...args: any[]) => any>(target: T, ctx?: GGContext): LocatorLookupAccess<InstanceType<T>>;
export function callOn<T extends object>(target: T, ctx?: GGContext): GGTestCallOn<T>;
export function callOn(target: any, ctx?: GGContext): any {
    ctx ??= new GGContext("Test")

    if (hasCallOnFactory(target)) {
        return target[CALL_ON_FACTORY](ctx);
    }

    const keyName = resolveKeyName(target);
    return createCallOnProxy(keyName, ctx);
}

// ============================================================================
// Helper functions for key resolution
// ============================================================================

/**
 * Resolve a target to its locator key name.
 * Handles GGContractClass, GGLocatorKey, and simple classes.
 */
function resolveKeyName(target: any): string {
    if (target instanceof GGContractClass) {
        return LOCATOR_KEY_PREFIX_FOR_CONTRACT + target.name;
    }
    if (target instanceof GGLocatorKey) {
        return target.name;
    }
    if (isSimpleClass(target)) {
        return LOCATOR_KEY_PREFIX_FOR_TESTABLE + target.name;
    }
    throw new Error(`Unknown callOn target: ${target?.name ?? target?.constructor?.name ?? typeof target}`);
}

/**
 * Create a proxy that intercepts method calls and returns GGTestActionForLocatorOnCall.
 */
function createCallOnProxy(keyName: string, ctx: GGContext, targetRuntimes?: GGTestRuntime[]): any {
    return new Proxy({}, {
        get(_, methodName: string) {
            return (...args: any[]) => new GGTestActionForLocatorOnCall<any>(ctx, keyName, methodName, args, targetRuntimes);
        }
    });
}

// ============================================================================
// Targeted callOn - for explicit runtime selection
// ============================================================================

/**
 * Invoke methods on runtime instances, targeting specific runtimes.
 * Use this when you need to explicitly select which runtime to call
 * when multiple different runtime classes have the same service.
 *
 * @param target - The target to call (class, GGLocatorKey, or GGContractClass)
 * @param runtimes - The specific runtimes to target
 * @param ctx - Optional context for the call
 *
 * @example
 * const f = GGTest.startWorker({chain: ChainRuntime, weather: WeatherOnlyRuntime});
 * // Both have WeatherService - explicitly target one:
 * await f.chain.callOn(WeatherService).getWeather("Test")
 */
export function callOnTargeted<T>(target: T, runtimes: GGTestRuntime[], ctx?: GGContext): GGTestCallOn<T>;
export function callOnTargeted(target: any, runtimes: GGTestRuntime[], ctx?: GGContext): any {
    ctx ??= new GGContext("Test");

    // Factory targets don't support runtime targeting - they control their own routing
    if (hasCallOnFactory(target)) {
        return target[CALL_ON_FACTORY](ctx);
    }

    const keyName = resolveKeyName(target);
    return createCallOnProxy(keyName, ctx, runtimes);
}

/**
 * Process a collection of targets and create callOn proxies for each.
 * It can be a recursive object where all "testable things" are replaced with callOn(X) handlers.
 * {serviceA: ApiA, sub: { serviceB: ApiB}} -> {serviceA: callOn(ApiA), sub: { serviceB: callOn(ApiB)}}
 */
export function callOnCollection<T extends object | any[]>(target: T, ctx?: GGContext): GGTestCallOnCollection<T> {
    const result: any = Array.isArray(target) ? [] : {};
    for (const key in target) {
        const value = target[key];
        if (value != null) {
            if (hasCallOnFactory(value) || value instanceof GGContractClass || value instanceof GGLocatorKey || isSimpleClass(value)) {
                result[key] = callOn(value as any, ctx);
            } else if (typeof value === 'object') {
                result[key] = callOnCollection(value, ctx);
            }
        }
    }
    return result;
}
