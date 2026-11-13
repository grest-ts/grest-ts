import {DeepPartial} from "@grest-ts/common";
import {captureStackSourceFile} from "../utils/captureStack";
import {GGExpectations} from "../utils/GGExpectations";
import {Raw} from "@grest-ts/schema";
import {GG_TEST_RUNNER, GGTestRunner} from "../GGTestRunner";
import {IGGTestWith} from "./IGGTestWith";
import {IGGTestInterceptor} from "./IGGTestInterceptor";
import {GGCallInterceptor, GGCallInterceptorConfig, GGCallTimes} from "./GGCallInterceptor";
import {singleRuntime} from "./GGTestSelector";
import type {GGTestRuntime} from "../GGTestRuntime";

type InterceptorFactory = new (runner: GGTestRunner, config: any) => GGCallInterceptor;

type MockReply<RequestBody, Reply> = (input: Raw<RequestBody>) => Raw<Reply> | Promise<Raw<Reply>>;

export class GGMockWith<RequestBody = any, ResponseData = any, ErrorsUnion = any> implements IGGTestWith {

    private readonly interceptorFactory: InterceptorFactory;
    private readonly interceptorConfig: Record<string, any>;
    private readonly definedInSourceFile: string;
    private _sleep: number = 0;
    private _times: GGCallTimes = {min: 1, max: 1};
    private _within?: number;
    private _target?: GGTestRuntime;

    private readonly expectations: GGExpectations<RequestBody> = new GGExpectations();
    private returnData?: Raw<ResponseData | ErrorsUnion> | MockReply<RequestBody, ResponseData | ErrorsUnion>;

    constructor(interceptorFactory: InterceptorFactory, config: Record<string, any>) {
        this.interceptorFactory = interceptorFactory;
        this.interceptorConfig = config;
        this.definedInSourceFile = captureStackSourceFile();
    }

    public createInterceptor(): IGGTestInterceptor {
        const test = GG_TEST_RUNNER.get();
        const config: GGCallInterceptorConfig = {
            ...this.interceptorConfig,
            definedInSourceFile: this.definedInSourceFile,
            sleep: this._sleep,
            times: this._times,
            target: this._target,
            passThrough: false,
            inputExpectations: this.expectations,
            returnData: this.returnData
        };
        return new this.interceptorFactory(test, config);
    }

    /** How long `.waitFor()` waits for this, instead of its 5 s default. */
    public within(timeMs: number): this {
        this._within = timeMs;
        return this;
    }

    public waitTimeoutMs(): number | undefined {
        return this._within;
    }

    public sleep(timeMs: number): this {
        this._sleep = timeMs;
        return this;
    }

    /**
     * Only calls that happen at this runtime: for a schema mock or spy, calls routed to it; for mockOf / spyOn, calls
     * of the method inside it. Takes a selector holding exactly one runtime (`t.relayA`, `t[1]`, `t.hub[1]`).
     */
    public on(runtime: {readonly runtimes: GGTestRuntime[]}): this {
        this._target = singleRuntime(runtime);
        return this;
    }

    public times(amount: number): this {
        this._times = {min: amount, max: amount};
        return this;
    }

    /** Allow any number of calls, none included. */
    public anyTimes(): this {
        this._times = {min: 0, max: Infinity};
        return this;
    }

    public toEqual(expectedData: Raw<RequestBody>): this {
        this.expectations.toEqual(expectedData as RequestBody)
        return this;
    }

    public toMatchObject(expectedData: DeepPartial<Raw<RequestBody>>): this {
        this.expectations.toMatchObject(expectedData as RequestBody)
        return this;
    }

    public toBeUndefined(): this {
        this.expectations.toBeUndefined()
        return this;
    }

    public toHaveLength(length: number): this {
        this.expectations.toHaveLength(length)
        return this;
    }

    public arrayToContain<Item extends RequestBody extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]): this {
        this.expectations.arrayToContain(...items)
        return this;
    }

    public arrayToContainEqual<Item extends RequestBody extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]): this {
        this.expectations.arrayToContainEqual(...items)
        return this;
    }

    /**
     * A function is called per call with that call's input, so one mock can answer each call differently; it may be async.
     * An error, returned or thrown by the function, is thrown at the caller.
     */
    public andReturn(data: Raw<ResponseData | ErrorsUnion> | MockReply<RequestBody, ResponseData | ErrorsUnion>): this {
        this.returnData = data as any;
        return this;
    }

    public requiresWaitFor(): boolean {
        return this.interceptorConfig.requiresWaitFor === true;
    }

}
