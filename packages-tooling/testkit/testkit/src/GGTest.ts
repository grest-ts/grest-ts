import {GG_TEST_RESOURCE, GG_TEST_RUNNER, GGTestRunner, TestResource} from "./GGTestRunner";
import {RuntimeConstructor, RuntimeInput, StartResult, Selector} from "./testers/RuntimeSelector";
import {GGTestMode, GGTestRuntime, GGTestRuntimeConfig} from "./GGTestRuntime";
import {createStartResult} from "./testers/GGTestSelector";
import {IGGTestWith} from "./testers/IGGTestWith";

// -------------------------------------------------
// GGTest - Static API for test setup
// -------------------------------------------------

/**
 * Make a result awaitable by adding a then() method.
 */
type Awaitable<T> = T & PromiseLike<T>;

/**
 * Static API for test setup operations.
 * Use GGTest.startWorker(), GGTest.with(), etc. in test files.
 *
 * @example
 * // Single runtime
 * const t = GGTest.startWorker(MainRuntime);
 * t.logs.cursor();
 *
 * // Multiple instances
 * const t = GGTest.startWorker([MainRuntime, MainRuntime]);
 * t[0].logs.cursor();
 *
 * // Named runtimes
 * const t = GGTest.startWorker({main: MainRuntime, sub: SubRuntime});
 * t.main.logs.cursor();
 * t.sub.config.update();
 */
export class GGTest {

    // -------------------------------------------------
    // Private state for runtime management
    // -------------------------------------------------

    // When GG_COVERAGE_MODE is set, force INLINE mode for all runtimes
    // This is needed because v8 coverage doesn't capture worker_threads or child_process
    private static readonly forceCoverageInline = process.env.GG_COVERAGE_MODE === '1';

    // -------------------------------------------------
    // Public static methods
    // -------------------------------------------------

    /**
     * Get a resource wrapper for calling test operations.
     * Returns an object with methods defined by the resource's [GG_TEST_RESOURCE].
     *
     * @example
     * GGTest.with(MyConfig.mysql).clone();
     * GGTest.with(MyConfig.mysql).clone("seed.sql");
     */
    public static with<T extends TestResource>(resource: T): T[typeof GG_TEST_RESOURCE] {
        return resource[GG_TEST_RESOURCE];
    }

    /**
     * Start runtimes in inline mode.
     * Inline mode runs the service code in the same process as the test.
     *
     * @example
     * // Single runtime
     * const t = GGTest.startInline(MainRuntime);
     *
     * // Array of runtimes (multiple instances)
     * const t = GGTest.startInline([MainRuntime, MainRuntime]);
     *
     * // Object with named runtimes
     * const t = GGTest.startInline({main: MainRuntime, sub: SubRuntime});
     */
    public static startInline<const T extends RuntimeInput>(input: T): Awaitable<StartResult<T>> {
        return this.startWithMode(input, GGTestMode.INLINE);
    }

    /**
     * Start runtimes in worker mode.
     * Worker mode runs the service code in a worker thread.
     *
     * @example
     * // Single runtime
     * const t = GGTest.startWorker(MainRuntime);
     *
     * // Array of runtimes (multiple instances)
     * const t = GGTest.startWorker([MainRuntime, MainRuntime]);
     *
     * // Object with named runtimes
     * const t = GGTest.startWorker({main: MainRuntime, sub: SubRuntime});
     */
    public static startWorker<T extends RuntimeInput>(input: T): Awaitable<StartResult<T>> {
        return this.startWithMode(input, GGTestMode.WORKER);
    }

    /**
     * Start runtimes in isolated mode.
     * Isolated mode runs the service code in a separate process.
     *
     * @example
     * // Single runtime
     * const t = GGTest.startIsolated(MainRuntime);
     *
     * // Array of runtimes (multiple instances)
     * const t = GGTest.startIsolated([MainRuntime, MainRuntime]);
     *
     * // Object with named runtimes
     * const t = GGTest.startIsolated({main: MainRuntime, sub: SubRuntime});
     */
    public static startIsolated<T extends RuntimeInput>(input: T): Awaitable<StartResult<T>> {
        return this.startWithMode(input, GGTestMode.ISOLATED);
    }

    /**
     * Wait for an async expectation to be satisfied.
     * Use this for standalone async expectations outside of action chains.
     *
     * Polls the expectation every 20ms until it's satisfied or timeout is reached.
     *
     * @param expectation - The expectation to wait for
     * @param timeout - Max time to wait in ms (default: 5000)
     *
     * @example
     * // Wait for a log after injecting an event
     * await UserEventsPublisher.inject.registered({...});
     * await GGTest.waitFor(t.logs.expect(/validation failed/i));
     *
     * @example
     * // Wait for a metric to be incremented
     * await GGTest.waitFor(t.main.metrics.expect(SomeMetric).inc({label: 'value'}));
     */
    public static async waitFor(expectation: IGGTestWith, timeout: number = 5000): Promise<void> {
        const interceptor = expectation.createInterceptor();
        const checkInterval = 20;
        const startTime = Date.now();

        await interceptor.register();

        try {
            await new Promise<void>((resolve, reject) => {
                const check = () => {
                    const elapsed = Date.now() - startTime;

                    if (interceptor.isCalled()) {
                        resolve();
                        return;
                    }

                    if (elapsed > timeout) {
                        reject(new Error(
                            `[GGTest.waitFor] Timeout after ${timeout}ms waiting for expectation`
                        ));
                        return;
                    }

                    setTimeout(check, checkInterval);
                };

                check();
            });

            await interceptor.validate();
            const error = interceptor.getMockValidationError();
            if (error) {
                throw error;
            }
        } finally {
            await interceptor.unregister();
        }
    }

    // -------------------------------------------------
    // Private helpers
    // -------------------------------------------------

    private static startWithMode<T extends RuntimeInput>(
        input: T,
        mode: GGTestMode
    ): Awaitable<StartResult<T>> {
        const test = GG_TEST_RUNNER.get();
        const constructors = this.extractConstructors(input);
        const runtimes = this.createRuntimes(test, constructors, {mode: this.getCoverageMode(mode)});
        const result = createStartResult(input, runtimes);

        if (test.started) {
            // We're inside a test block - start immediately
            // Cleanup is handled by the global afterEach registered in initInTestCleanup
            const startupPromise = this.startRuntimesInTestBlock(runtimes);
            return this.makeAwaitable(result, startupPromise);
        } else {
            // We're in describe block - normal flow, runtimes start in beforeAll
            // Return immediately-resolved thenable for consistency
            return this.makeAwaitable(result, Promise.resolve());
        }
    }

    /**
     * Extract runtime constructors from the input in the order they should be created.
     */
    private static extractConstructors(input: RuntimeInput): RuntimeConstructor[] {
        // Single runtime
        if ('NAME' in input) {
            return [input as RuntimeConstructor];
        }

        // Array of runtimes
        if (Array.isArray(input)) {
            return input;
        }

        // Object: { main: MainRuntime, sub: [SubRuntime, SubRuntime] }
        const constructors: RuntimeConstructor[] = [];
        for (const value of Object.values(input)) {
            if (Array.isArray(value)) {
                constructors.push(...value);
            } else {
                constructors.push(value);
            }
        }
        return constructors;
    }

    /**
     * Start runtimes immediately (for in-test usage).
     * Runtimes are automatically tracked by the runner for afterEach cleanup.
     */
    private static async startRuntimesInTestBlock(runtimes: GGTestRuntime[]): Promise<void> {
        for (const runtime of runtimes) {
            await runtime.start();
        }
    }

    /**
     * Makes a result thenable by adding a then() method.
     * This allows both sync and async usage patterns.
     *
     * IMPORTANT: The then() method removes itself after being called to prevent
     * infinite thenable resolution. When onfulfilled returns the result,
     * JavaScript would try to resolve it again if then() still existed.
     */
    private static makeAwaitable<T>(result: T, startupPromise: Promise<void>): Awaitable<T> {
        const awaitable = result as Awaitable<T>;

        awaitable.then = <TResult1 = T, TResult2 = never>(
            onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
        ): Promise<TResult1 | TResult2> => {
            // Remove then() to prevent infinite thenable resolution
            delete (awaitable as any).then;

            return startupPromise.then(
                () => onfulfilled ? onfulfilled(result) : result as unknown as TResult1,
                onrejected
            );
        };
        return awaitable;
    }

    private static getCoverageMode(requestedMode: GGTestMode): GGTestMode {
        if (this.forceCoverageInline && requestedMode !== GGTestMode.INLINE) {
            return GGTestMode.INLINE;
        }
        return requestedMode;
    }

    private static createRuntimes(
        test: GGTestRunner,
        services: RuntimeConstructor[],
        config: GGTestRuntimeConfig
    ): GGTestRuntime[] {
        const createdRuntimes: GGTestRuntime[] = []

        for (const service of services) {
            const runtimeConstructor = service as RuntimeConstructor;

            // Validate that runtime has NAME property
            if (!runtimeConstructor.NAME) {
                throw new Error(
                    `Runtime '${service.name}' must define a static NAME property. ` +
                    `Add 'public static readonly NAME = "yourname"' to the class.`
                );
            }

            // Validate that runtime has SOURCE_MODULE_URL (set by GGRuntime.cli())
            if (!runtimeConstructor.SOURCE_MODULE_URL) {
                throw new Error(
                    `Runtime '${service.name}' has no source path. ` +
                    `Make sure the runtime file calls: ${service.name}.cli(import.meta.url)`
                );
            }

            const className = service.name;
            const name = runtimeConstructor.NAME;
            const sourcePath = runtimeConstructor.SOURCE_MODULE_URL;

            const runtime = new GGTestRuntime(test, sourcePath, className, name, config);
            // Store factory for inline mode — avoids dynamic import which causes
            // duplicate module loading in Vite/vitest environments
            runtime.runtimeFactory = () => new (runtimeConstructor as any)();
            createdRuntimes.push(runtime)
        }
        return createdRuntimes;
    }
}

// -------------------------------------------------
// Legacy exports for backwards compatibility
// -------------------------------------------------

/**
 * @deprecated Use StartResult instead
 */
export type {RuntimeResult} from "./testers/RuntimeSelector";

/**
 * @deprecated Use Awaitable<StartResult<T>> instead
 */
export type AwaitableRuntimeResult<R extends RuntimeConstructor[]> = Awaitable<Selector<R>>;
