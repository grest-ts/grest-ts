import {captureStackSourceFile} from "../utils/captureStack";
import {GGExpectations} from "../utils/GGExpectations";
import {ERROR, GGErrorData, Raw} from "@grest-ts/schema";
import {ConstructorOf, DeepPartial} from "@grest-ts/common";
import {GG_TEST_RUNNER, GGTestRunner} from "../GGTestRunner";
import {IGGTestWith} from "./IGGTestWith";
import {IGGTestInterceptor} from "./IGGTestInterceptor";
import {GGCallInterceptor, GGCallInterceptorConfig, GGCallTimes} from "./GGCallInterceptor";

type InterceptorFactory = new (runner: GGTestRunner, config: any) => GGCallInterceptor;

export class GGSpyWith<RequestBody = any, ResponseData = any, ErrorsUnion = any> implements IGGTestWith {

    private readonly interceptorFactory: InterceptorFactory;
    private readonly interceptorConfig: Record<string, any>;
    private readonly definedInSourceFile: string;

    private readonly _expectInput: GGExpectations<RequestBody> = new GGExpectations()
    private _expectError?: ConstructorOf<ERROR<any, any>>
    private _expectErrorContext?: Partial<GGErrorData>
    private readonly _expectOutput: GGExpectations<ResponseData> = new GGExpectations()

    private activeExpect: GGExpectations<any>;

    private _sleep: number = 0;
    private _times: GGCallTimes = {min: 1, max: 1};
    private _within?: number;

    constructor(interceptorFactory: InterceptorFactory, config: Record<string, any>) {
        this.interceptorFactory = interceptorFactory;
        this.interceptorConfig = config;
        this.definedInSourceFile = captureStackSourceFile();
        this.activeExpect = this._expectInput;
    }

    public createInterceptor(): IGGTestInterceptor {
        const test = GG_TEST_RUNNER.get();
        const config: GGCallInterceptorConfig = {
            ...this.interceptorConfig,
            definedInSourceFile: this.definedInSourceFile,
            sleep: this._sleep,
            times: this._times,
            passThrough: true,
            inputExpectations: this._expectInput,
            outputExpectations: this._expectOutput,
            expectError: this._expectError,
            expectErrorContext: this._expectErrorContext
        };
        return new this.interceptorFactory(test, config);
    }

    /**
     * Wait ms before returning data.
     */
    public sleep(timeMs: number): this {
        this._sleep = timeMs;
        return this;
    }

    /**
     * Expect this mock to be called amount of times.
     */
    /** How long `.waitFor()` waits for this, instead of its 5 s default. */
    public within(timeMs: number): this {
        this._within = timeMs;
        return this;
    }

    public waitTimeoutMs(): number | undefined {
        return this._within;
    }

    public times(amount: number): this {
        this._times = {min: amount, max: amount};
        return this;
    }

    /** One call or more. */
    public atLeastOnce(): this {
        this._times = {min: 1, max: Infinity};
        return this;
    }

    public get response(): GGSpyWith<ResponseData, never, never> {
        this.activeExpect = this._expectOutput;
        this._expectOutput.flush();
        return this as any;
    }

    /** The call ends with this error; the matchers after it check the error's data. */
    public toBeError<Type extends ConstructorOf<ErrorsUnion>>(type: Type): GGSpyWith<ErrorDataOf<InstanceType<Type>>, never, never> {
        this._expectError = type as ConstructorOf<any>;
        this.activeExpect = this._expectOutput;
        this._expectOutput.flush();
        return this as any;
    }

    /** After `.toBeError()`: matched like `toMatchObject` against the error's context, e.g. its `displayMessage`. */
    public withContext(context: Partial<GGErrorData>): this {
        if (!this._expectError) throw new Error(".withContext() checks the error's context: call .toBeError() first.");
        this._expectErrorContext = context;
        return this;
    }

    public toEqual(expectedData: Raw<RequestBody>): this {
        this.activeExpect.toEqual(expectedData as RequestBody)
        return this;
    }

    public toMatchObject(expectedData: DeepPartial<Raw<RequestBody>>): this {
        this.activeExpect.toMatchObject(expectedData as RequestBody)
        return this;
    }

    public responseToMatchObject(expectedData: DeepPartial<Raw<ResponseData>>): this {
        this._expectOutput.toMatchObject(expectedData as ResponseData)
        return this;
    }

    public toBeUndefined(): this {
        this.activeExpect.toBeUndefined()
        return this;
    }

    public toHaveLength(length: number): this {
        this.activeExpect.toHaveLength(length)
        return this;
    }

    public arrayToContain<Item extends RequestBody extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]): this {
        this.activeExpect.arrayToContain(...items)
        return this;
    }

    public arrayToContainEqual<Item extends RequestBody extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]): this {
        this.activeExpect.arrayToContainEqual(...items)
        return this;
    }

    public requiresWaitFor(): boolean {
        return this.interceptorConfig.requiresWaitFor === true;
    }
}

type ErrorDataOf<E> = E extends ERROR<any, infer Data> ? Data : never;
