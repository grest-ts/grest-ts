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
import {GG_TEST_RUNNER, GGTestRunner, WorkerRunner} from "@grest-ts/testkit";
import {installTestClock} from "@grest-ts/testkit/internal";
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
import {inject} from "vitest";

installTestClock();

const scope = new GGLocatorScope("GGTestRoot").enter()

// GGTestRunner.reusableId: unique among concurrent workers, 1..maxWorkers.
process.env.GG_TEST_WORKER ??= process.env.VITEST_POOL_ID;

const isolate = inject("grest-ts:isolate");
// Files that share a test process may share runtime workers too: each file still gets fresh runtime instances.
WorkerRunner.setReuse(isolate === false);

GGLog.init();
GGLog.add(new GGLoggerConsole());

const warnedNoGlobalSetup = Symbol.for("grest-ts:testkit-vitest:warnedNoGlobalSetup");
if (isolate === undefined && !(globalThis as any)[warnedNoGlobalSetup]) {
    (globalThis as any)[warnedNoGlobalSetup] = true;
    GGLog.warn("testkit-vitest", "globalSetup '@grest-ts/testkit-vitest/globalSetup' is missing from the vitest config: " +
        "database clones and shared test resources fail without it, and runtime workers aren't reused under isolate: false.");
}

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
            return target.call(thisArg, name, suiteFactory(name, callback), ...rest);
        },
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            // Wrap modifier functions (sequential, concurrent, only, skip, todo, skipIf, runIf, shuffle)
            if (typeof value === 'function') {
                if (prop === 'each' || prop === 'for') {
                    return wrapDescribeEachFunction(value, target);
                }
                return wrapDescribeFunction(value);
            }
            return value;
        }
    });
}

/**
 * The suite factory sets up its context each time vitest runs it, so every case of a `describe.each` gets its own.
 * Top-level suites get new test infrastructure (IPCServer, discovery, etc.); nested ones reuse their parent's.
 */
function suiteFactory(name: string, callback: (...args: any[]) => void): (...args: any[]) => void {
    if (GG_TEST_RUNNER.has()) {
        const ggTest = GG_TEST_RUNNER.get();
        const parent = GGLocator.getScope();
        return (...cbArgs) => parent.branch(name).run(() => {
            beforeAll(() => ggTest.runBeforeAllHooks());
            afterAll(() => ggTest.runAfterAllHooks());
            callback(...cbArgs);
        });
    }
    return (...cbArgs) => scope.run(() => {
        const describeBlockCtx = scope.branch(name);

        const ipcServer = new IPCServer(0);
        const discoveryServer = new GGLocalDiscoveryServer(ipcServer);
        const ggTest = new GGTestRunner(ipcServer, discoveryServer);
        const discoveryClient = new GGTestDiscoveryClient(discoveryServer);

        describeBlockCtx.set(GG_TEST_RUNNER, ggTest);
        describeBlockCtx.set(GG_DISCOVERY, discoveryClient);

        // Hooks are registered inside the factory so vitest associates them with this suite.
        describeBlockCtx.run(() => {
            beforeAll(() => ggTest.start(), 30000);
            beforeEach(() => ggTest.runBeforeEachHooks());
            afterEach(() => ggTest.runAfterEachHooks());
            afterAll(() => ggTest.teardown(), 30000);
            callback(...cbArgs);
        });
    });
}

function wrapDescribeEachFunction(eachFn: any, target: any): any {
    return (...eachArgs: any[]) => {
        const describeFn = eachFn.apply(target, eachArgs);
        return (name: string, callback: (...args: any[]) => void, ...rest: any[]) => describeFn(name, suiteFactory(name, callback), ...rest);
    };
}

/**
 * Wraps the .each() function which has special semantics:
 * .each(data)(name, fn) - returns a function that creates parameterized tests
 *
 * @param eachFn - The original .each function
 * @param wrapperFn - The wrapper function (wrapTestFunction)
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

// Under `isolate: false` vitest re-runs this file for every test file in the same worker while keeping its globals, so
// each run wraps the original function, never the previous file's wrapper.
const originals: WeakMap<object, any> = ((globalThis as any)[Symbol.for("grest-ts:testkit-vitest:originals")] ??= new WeakMap());

function rewrap(name: string, wrap: (original: any) => any): void {
    const g = globalThis as any;
    const original = originals.get(g[name]) ?? g[name];
    g[name] = wrap(original);
    originals.set(g[name], original);
}

rewrap("describe", wrapDescribeFunction);
rewrap("suite", wrapDescribeFunction);

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
                // Awaited inside the scope: a returned GGTestAction only runs when then() is called on it.
                return target.call(thisArg, name, (...fnArgs: any[]) => testCtx.run(async () => await fn(...fnArgs)), timeout);
            } else {
                return target(fn, timeout);
            }
        },
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            // Wrap modifier functions (sequential, concurrent, only, skip, todo, skipIf, runIf, fails)
            if (typeof value === 'function') {
                // .each/.for return a function when called with data
                if (prop === 'each' || prop === 'for') {
                    return wrapEachFunction(value, wrapTestFunction, target);
                }
                return wrapTestFunction(value);
            }
            return value;
        }
    });
}

rewrap("test", wrapTestFunction);
rewrap("it", wrapTestFunction);

// ---------------------------------------------
// Custom lifecycle hooks (beforeAll, beforeEach, afterAll, afterEach)

function wrapLifecycleHook(original: any) {
    return new Proxy(original, {
        apply(target, _, args) {
            const [fn, timeout] = args;
            if (GGLocator.hasScope()) {
                const describeCtx = GGLocator.getScope();
                return target(() => describeCtx.run(async () => await fn()), timeout);
            } else {
                return target(fn, timeout);
            }
        }
    });
}

rewrap("beforeAll", wrapLifecycleHook);
rewrap("beforeEach", wrapLifecycleHook);
rewrap("afterAll", wrapLifecycleHook);
rewrap("afterEach", wrapLifecycleHook);

// Make this file a module
export {};
