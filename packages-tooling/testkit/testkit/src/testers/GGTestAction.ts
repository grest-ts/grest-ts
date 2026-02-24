import {IGGTestWith} from "./IGGTestWith";
import {IGGTestInterceptor} from "./IGGTestInterceptor";
import {GGLog} from "@grest-ts/logger";
import {LOG_COLORS} from "@grest-ts/logger-console";
import {captureStackSourceFile} from "../utils/captureStack";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {Raw} from "@grest-ts/schema";
import {DeepPartial} from "@grest-ts/common";
import {GGExpectations} from "../utils/GGExpectations";

interface WaitForInterceptor {
    interceptor: IGGTestInterceptor;
    timeout: number;
}

/**
 * Configuration for a test action's logging behavior.
 */
export interface GGTestActionConfig {
    /** If true, the action has no response to log (e.g., fire-and-forget WebSocket message) */
    noResponse: boolean;
    /** Data used for logging the action */
    logData: {
        /** Description shown in logs, e.g., "[POST /api/users]" or "[Config MyConfig.timeout]" */
        message: string;
        /** Optional context to display (e.g., auth, language) */
        context?: any;
        /** Optional request payload to log when executing */
        request?: any
    };
}

/**
 * Base class for test actions that can be awaited and chained with expectations.
 *
 * Test actions are PromiseLike objects that execute when awaited. They support
 * attaching interceptors (mocks, log expectations, spies) that are validated
 * during execution.
 *
 * @example
 * // Simple action - just await to execute
 * const user = await client.getUser(123);
 *
 * // With sync expectation - mock must be called during the action
 * await client.createUser({name: "Alice"})
 *     .with(mockEmailService.sendWelcome.toBeCalledOnce());
 *
 * // With async expectation - waits for event after action completes
 * await client.triggerAsyncJob()
 *     .waitFor(t.logs.expect("Job completed"), 10000);
 *
 * @typeParam T - The type returned when the action completes
 */
export abstract class GGTestAction<T> implements Promise<T> {

    readonly [Symbol.toStringTag]: string = "GGTestAction";

    protected readonly ctx: GGContext;
    private readonly config: GGTestActionConfig;
    protected readonly interceptors: IGGTestInterceptor[] = [];
    protected readonly _waitForInterceptors: WaitForInterceptor[] = [];
    private readonly definedInSourceFile: string;

    protected readonly responseExpectations: GGExpectations<any> = new GGExpectations()

    constructor(ctx: GGContext, config: GGTestActionConfig) {
        if (ctx === undefined) throw new Error("No ctx provided!")
        this.ctx = ctx;
        this.config = config;
        this.definedInSourceFile = captureStackSourceFile();
        new GGContext("Test").run(() => {
            GG_TRACE.init();
            const separator = "-".repeat(100);
            GGLog.info(this, separator)
            GGLog.info(this,
                this.logMsg("new", this.config.logData.message)
                + (this.config.logData.context ? "\n" + LOG_COLORS.bgOrange + LOG_COLORS.black
                    + "Context: " + LOG_COLORS.reset + LOG_COLORS.orange + JSON.stringify(this.config.logData.context) + LOG_COLORS.reset : "")
                + "\n" + this.definedInSourceFile
            );
        });

    }

    public toEqual(expectedData: Raw<T>): this {
        this.responseExpectations.toEqual(expectedData as T);
        return this;
    }

    public toMatchObject(expectedData: DeepPartial<Raw<T>>): this {
        this.responseExpectations.toMatchObject(expectedData as T);
        return this;
    }

    public toBeUndefined(): this {
        this.responseExpectations.toBeUndefined();
        return this;
    }

    public toHaveLength(length: number): this {
        this.responseExpectations.toHaveLength(length);
        return this;
    }

    public arrayToContain<Item extends T extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]): this {
        this.responseExpectations.arrayToContain(...items);
        return this;
    }

    public arrayToContainEqual<Item extends T extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]): this {
        this.responseExpectations.arrayToContainEqual(...items);
        return this;
    }

    /**
     * Attach expectations that must be satisfied during action execution.
     *
     * Interceptors are registered before the action runs and validated immediately after.
     * If an expectation fails (e.g., mock not called), the test fails before checking
     * the action's response - this surfaces the root cause of failures first.
     *
     * @example
     * await client.createOrder({items: [...]})
     *     .with(mockInventory.reserve.toBeCalledOnce())
     *     .with(mockPayment.charge.toMatchObject({amount: 100}));
     */
    public with(...expectations: IGGTestWith[]): this {
        for (const expectation of expectations) {
            // Check if this expectation requires async processing
            if (expectation.requiresWaitFor?.()) {
                throw new Error(
                    `This interceptor cannot be used with .with() because it handles async events ` +
                    `that occur after the HTTP response.\n\n` +
                    `SQS message processing happens asynchronously - the message is delivered to the ` +
                    `subscriber queue after the HTTP request completes.\n\n` +
                    `To verify SQS events, use one of these approaches:\n` +
                    `  1. Use .waitFor() with log verification:\n` +
                    `     .waitFor(t.worker.logs.expect(/expected log message/))\n\n` +
                    `  2. Use .waitFor() with the SQS interceptor (waits for async processing):\n` +
                    `     .waitFor(SqsResource.spy.toMatchObject({...}))\n`
                );
            }
            this.interceptors.push(expectation.createInterceptor());
        }
        return this;
    }

    /**
     * Attach an expectation that may be satisfied after the action completes.
     *
     * Use this for async side effects - when the action triggers something that
     * happens later (e.g., background job, delayed log, async notification).
     * The test will poll until the expectation is satisfied or timeout is reached.
     *
     * @param expectation - The expectation to wait for
     * @param timeout - Max time to wait in ms (default: 5000)
     *
     * @example
     * // Action returns immediately, but logs after 100ms
     * await client.triggerBackgroundJob({id: 123})
     *     .waitFor(t.logs.expect("Job 123 completed"), 10000);
     */
    public waitFor(expectation: IGGTestWith, timeout: number = 5000): this {
        const interceptor = expectation.createInterceptor();
        this.interceptors.push(interceptor);
        this._waitForInterceptors.push({
            interceptor,
            timeout
        });
        return this;
    }

    public then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected);
    }

    public catch<TResult = never>(
        onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
    ): Promise<T | TResult> {
        return this.execute().catch(onrejected);
    }

    public finally(onfinally?: (() => void) | null): Promise<T> {
        return this.execute().finally(onfinally);
    }

    protected async execute(): Promise<T> {
        return this.ctx.run(async () => {
            GG_TRACE.init();
            GGLog.info(this,
                this.logMsg("execute", this.config.logData.message),
                this.config.logData.request
            )
            let rawResult: tActionRawData = undefined;
            try {
                await Promise.all(this.interceptors.map(i => i.register()));
                rawResult = await this.executeAction()
                await new Promise(resolve => setTimeout(resolve, 25));
            } finally {
                await Promise.all(this.interceptors.map(i => i.unregister()));
            }

            const waitForSet = new Set(this._waitForInterceptors.map(w => w.interceptor));

            // Validate non-wait interceptors immediately
            for (const interceptor of this.interceptors) {
                if (!waitForSet.has(interceptor)) {
                    await interceptor.validate();
                }
            }

            // Check for validation errors from non-wait interceptors
            for (const interceptor of this.interceptors) {
                if (!waitForSet.has(interceptor)) {
                    const error = interceptor.getMockValidationError();
                    if (error) {
                        throw error;
                    }
                }
            }

            let result: any = undefined;
            if (!this.config.noResponse) {
                result = await this.processRawResponse(rawResult);
                this.responseExpectations.check(result);
            }

            if (this._waitForInterceptors.length > 0) {
                await this._waitForAllInterceptors();
            }

            // Validate wait interceptors after waiting
            for (const {interceptor} of this._waitForInterceptors) {
                await interceptor.validate();
                const error = interceptor.getMockValidationError();
                if (error) {
                    throw error;
                }
            }

            GGLog.info(this,
                this.logMsg("finished", this.config.logData.message),
                this.config.noResponse ? "Result: (void)" : rawResult
            )

            return result;
        });
    }

    /**
     * Execute the core action (e.g., make HTTP request, send WebSocket message).
     * Subclasses implement this with their specific action logic.
     *
     * @returns The raw response data (before parsing/transformation)
     */
    protected abstract executeAction(): Promise<tActionRawData>;

    /**
     * Process and validate the raw response from executeAction().
     * Called AFTER mock validation, so mock errors surface first.
     *
     * Subclasses implement this to:
     * - Parse the raw response into the expected type T
     * - Check response expectations (e.g., toMatchObject, toEqual)
     *
     * @param result - Raw response from executeAction()
     * @returns The parsed/validated result of type T
     */
    protected processRawResponse(result: tActionRawData): Promise<T> {
        return result;
    }

    private async _waitForAllInterceptors(): Promise<void> {
        const pending = new Map(
            this._waitForInterceptors.map(w => [w.interceptor, w.timeout])
        );

        const checkInterval = 20;
        const actionEndTime = Date.now();

        return new Promise((resolve, reject) => {
            const check = () => {
                const elapsed = Date.now() - actionEndTime;

                for (const [interceptor, timeout] of pending) {
                    if (interceptor.isCalled()) {
                        pending.delete(interceptor);
                    } else if (elapsed > timeout) {
                        reject(new Error(
                            `[Test Failed] Timeout waiting for interceptor after ${timeout}ms`
                        ));
                        return;
                    }
                }

                if (pending.size === 0) {
                    resolve();
                    return;
                }

                setTimeout(check, checkInterval);
            };

            check();
        });
    }

    private logMsg(type: "new" | "execute" | "finished", msg: string): string {
        let pref = "";
        let color: string = "";
        if (type === "new") {
            pref = "New test action "
            color = LOG_COLORS.reset + LOG_COLORS.bgBlack + LOG_COLORS.white
        } else if (type === "execute") {
            pref = "Executing test action to "
            color = LOG_COLORS.reset + LOG_COLORS.bgGray + LOG_COLORS.black
        } else if (type === "finished") {
            pref = "Finished test action to "
            color = LOG_COLORS.reset + LOG_COLORS.bgGray + LOG_COLORS.black
        }
        return color + pref + msg + LOG_COLORS.reset;
    }
}

/**
 * Branded type for raw action response data.
 * Used to distinguish raw responses from parsed results in the type system.
 */
export type tActionRawData = any & { tActionRawData: never }