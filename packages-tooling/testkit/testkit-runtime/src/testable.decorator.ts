/**
 * Minimal runtime for @testable decorator.
 * This file has NO dependencies on testkit internals and is safe for production bundles.
 *
 * The @testable decorator registers class instances in GGLocator, enabling
 * direct method invocation from tests via the testable() function.
 */

import {GGLocator, GGLocatorKey} from "@grest-ts/locator";

export const LOCATOR_KEY_PREFIX_FOR_TESTABLE = "@testable:";

/**
 * Decorator to mark a class as testable - enabling direct method invocation from tests.
 *
 * When a @testable class is instantiated during runtime composition, the instance
 * is automatically registered in GGLocator. Tests can then invoke methods directly
 * on this instance via the testable() function.
 *
 * For single instances (the common case), just use the decorator:
 * ```typescript
 * @testable
 * export class MyService { ... }
 *
 * // In tests:
 * await testable(MyService).doSomething()
 * ```
 *
 * For multiple instances, register with custom keys:
 * ```typescript
 * const primaryKey = new GGLocatorKey<MyService>("MyService:primary");
 * const secondaryKey = new GGLocatorKey<MyService>("MyService:secondary");
 *
 * // In compose:
 * primaryKey.set(new MyService(...));
 * secondaryKey.set(new MyService(...));
 *
 * // In tests:
 * await testable(primaryKey).doSomething()
 * await testable(secondaryKey).doSomething()
 * ```
 */
export function testable<T extends { new(...args: any[]): {} }>(target: T): T {
    const key = new GGLocatorKey<InstanceType<T>>(LOCATOR_KEY_PREFIX_FOR_TESTABLE + target.name);

    // Create a new class that extends the target and registers on construction
    const wrappedClass = class extends (target as any) {
        constructor(...args: any[]) {
            super(...args);
            const scope = GGLocator.tryGetScope();
            if (scope) {
                if (scope.has(key)) {
                    // First registration wins - log warning and skip
                    // Using console.warn as GGLog may not be available in all contexts
                    console.warn(
                        `[@testable] Instance already registered for '${key.name}'. ` +
                        `First registration wins. If you need multiple instances, register them manually with custom keys.`
                    );
                } else {
                    scope.set(key, this as InstanceType<T>);
                }
            }
        }
    };

    // Preserve class name for debugging and key generation
    Object.defineProperty(wrappedClass, 'name', {value: target.name});

    // Copy static properties
    for (const prop of Object.getOwnPropertyNames(target)) {
        if (prop !== 'prototype' && prop !== 'name' && prop !== 'length') {
            const descriptor = Object.getOwnPropertyDescriptor(target, prop);
            if (descriptor) {
                Object.defineProperty(wrappedClass, prop, descriptor);
            }
        }
    }

    return wrappedClass as T;
}
