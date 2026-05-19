import "./_dedupCheck";
// Plugin testkit type-augmentations live in ./extensions.d.ts (auto-generated
// by scripts/packager/generate-testkit-extensions.ts and referenced from
// package.json `exports.types`). It is included in this package's tsc program
// via the `src/**/*` include pattern — no runtime import needed here.
// Runtime registration of those same extensions flows through
// GGExtensionDiscovery.load() below.

/**
 * Test setup file
 * This file is automatically loaded before tests run to register global utilities.
 * It wraps vitest hooks to provide test context via GGAsyncContext.
 */
import {GGLog} from "@grest-ts/logger";
import {GGLoggerConsole} from "@grest-ts/logger-console";
import {IPCServer} from "@grest-ts/ipc";
import {GG_TEST_RUNNER, GGTestRunner} from "@grest-ts/testkit";
import {GGLocator, GGLocatorScope} from "@grest-ts/locator";
// -------------------------------------------------
// Global test mode marker
// -------------------------------------------------
// Set a global flag so config files can detect test mode at import time.
// AsyncLocalStorage doesn't work at module import time, so we use a simple global.
import {GG_DISCOVERY} from "@grest-ts/discovery";
import {GGLocalDiscoveryServer} from "@grest-ts/discovery-local";
import {GGTestDiscoveryClient} from "./GGTestDiscoveryClient";
import {GGExtensionDiscovery} from "@grest-ts/common";

const scope = new GGLocatorScope("GGTestRoot").enter()

GGLog.init();
GGLog.add(new GGLoggerConsole());

// -------------------------------------------------
// Load testkit extensions
// -------------------------------------------------
// Testkits must be loaded before tests run because GGTest.with()
// accesses [GG_TEST_RESOURCE] which is set by testkit extensions.

await new GGExtensionDiscovery('testkit').load();

// ---------------------------------------------
// Wrap describe to set up test context
// ---------------------------------------------

/**
 * Creates a wrapped describe function that sets up GGTest context.
 * This wrapper is applied to describe and all its modifiers (sequential, concurrent, only, skip, etc.)
 *
 * For top-level describes: Creates new test infrastructure (IPCServer, discovery, etc.)
 * For nested describes: Reuses parent's infrastructure
 */
function wrapDescribeFunction(target: any): any {
    return new Proxy(target, {
        apply(target, thisArg, args) {
            const [name, callback, ...rest] = args;

            if (GG_TEST_RUNNER.has()) {
                const ggTest = GG_TEST_RUNNER.get();
                const scope = GGLocator.getScope().branch(name);
                target.call(thisArg, name, (...cbArgs: any[]) => scope.run(() => {
                    beforeAll(() => ggTest.runBeforeAllHooks());
                    afterAll(() => ggTest.runAfterAllHooks());
                    callback(...cbArgs);
                }), ...rest)

            } else {
                scope.run(() => {
                    // Don't use .enter() - the scope is used via .run() in callOriginalDescribe
                    const describeBlockCtx = GGLocator.getScope().branch(name);

                    const ipcServer = new IPCServer(0);
                    const discoveryServer = new GGLocalDiscoveryServer(ipcServer);
                    const ggTest = new GGTestRunner(ipcServer, discoveryServer);
                    const discoveryClient = new GGTestDiscoveryClient(discoveryServer);

                    describeBlockCtx.set(GG_TEST_RUNNER, ggTest);
                    describeBlockCtx.set(GG_DISCOVERY, discoveryClient);

                    // Call original describe with hooks registered INSIDE the callback
                    // This ensures Vitest properly associates hooks with this suite
                    target.call(thisArg, name, (...cbArgs: any[]) => describeBlockCtx.run(() => {
                        beforeAll(() => ggTest.start(), 30000);
                        beforeEach(() => ggTest.runBeforeEachHooks());
                        afterEach(() => ggTest.runAfterEachHooks());
                        afterAll(() => ggTest.teardown(), 30000);
                        callback(...cbArgs);
                    }), ...rest)
                })
            }
        },
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            // Wrap modifier functions (sequential, concurrent, only, skip, todo, skipIf, runIf, shuffle)
            if (typeof value === 'function') {
                // Special handling for .each - it returns a function when called with data
                if (prop === 'each') {
                    return wrapEachFunction(value, wrapDescribeFunction, target);
                }
                return wrapDescribeFunction(value);
            }
            return value;
        }
    });
}

/**
 * Wraps the .each() function which has special semantics:
 * .each(data)(name, fn) - returns a function that creates parameterized tests
 *
 * @param eachFn - The original .each function
 * @param wrapperFn - The wrapper function (wrapDescribeFunction or wrapTestFunction)
 * @param target - The original describe/test target to bind 'this' context
 */
function wrapEachFunction(eachFn: any, wrapperFn: (target: any) => any, target: any): any {
    return (...eachArgs: any[]) => {
        // Call original .each(data) with correct 'this' context - returns a function
        const describeFn = eachFn.apply(target, eachArgs);
        // Wrap the returned function so it sets up test context
        return wrapperFn(describeFn);
    };
}

if (!(globalThis as any).describe) {
    throw new Error("This functionality is meant to be used within vitest! You are importing this while manually to your code, you should not do that. Check your imports for 'global.ts'")
}

(globalThis as any).describe = wrapDescribeFunction((globalThis as any).describe);
(globalThis as any).suite = wrapDescribeFunction((globalThis as any).suite);

// ---------------------------------------------
// Wrap test to run in test context
// ---------------------------------------------

/**
 * Creates a wrapped test function that runs in GGTest context.
 * This wrapper is applied to test and all its modifiers (sequential, concurrent, only, skip, etc.)
 */
function wrapTestFunction(target: any): any {
    return new Proxy(target, {
        apply(target, thisArg, args) {
            const [name, fn, timeout] = args;
            if (GGLocator.hasScope()) {
                const testCtx = GGLocator.getScope().branch("Test: " + name);
                // Preserve fn args (used by .each() to pass test data)
                return target.call(thisArg, name, (...fnArgs: any[]) => testCtx.run(() => fn(...fnArgs)), timeout);
            } else {
                return target(fn, timeout);
            }
        },
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            // Wrap modifier functions (sequential, concurrent, only, skip, todo, skipIf, runIf, fails)
            if (typeof value === 'function') {
                // Special handling for .each - it returns a function when called with data
                if (prop === 'each') {
                    return wrapEachFunction(value, wrapTestFunction, target);
                }
                return wrapTestFunction(value);
            }
            return value;
        }
    });
}

(globalThis as any).test = wrapTestFunction((globalThis as any).test);
(globalThis as any).it = wrapTestFunction((globalThis as any).it);

// ---------------------------------------------
// Custom lifecycle hooks (beforeAll, beforeEach, afterAll, afterEach)

function wrapLifecycleHook(original: any) {
    return new Proxy(original, {
        apply(target, _, args) {
            const [fn, timeout] = args;
            if (GGLocator.hasScope()) {
                const describeCtx = GGLocator.getScope();
                return target(() => describeCtx.run(fn), timeout);
            } else {
                return target(fn, timeout);
            }
        }
    });
}

(globalThis as any).beforeAll = wrapLifecycleHook((globalThis as any).beforeAll);
(globalThis as any).beforeEach = wrapLifecycleHook((globalThis as any).beforeEach);
(globalThis as any).afterAll = wrapLifecycleHook((globalThis as any).afterAll);
(globalThis as any).afterEach = wrapLifecycleHook((globalThis as any).afterEach);

// Make this file a module
export {};
