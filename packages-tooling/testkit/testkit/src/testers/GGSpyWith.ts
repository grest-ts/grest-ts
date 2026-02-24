import {captureStackSourceFile} from "../utils/captureStack";
import {GGExpectations} from "../utils/GGExpectations";
import {Raw} from "@grest-ts/schema";
import {ConstructorOf, DeepPartial} from "@grest-ts/common";
import {GG_TEST_RUNNER, GGTestRunner} from "../GGTestRunner";
import {IGGTestWith} from "./IGGTestWith";
import {IGGTestInterceptor} from "./IGGTestInterceptor";
import {GGCallInterceptor, GGCallInterceptorConfig} from "./GGCallInterceptor";

type InterceptorFactory = new (runner: GGTestRunner, config: any) => GGCallInterceptor;

export class GGSpyWith<RequestBody = any, ResponseData = any, ErrorsUnion = any> implements IGGTestWith {

    private readonly interceptorFactory: InterceptorFactory;
    private readonly interceptorConfig: Record<string, any>;
    private readonly definedInSourceFile: string;

    private readonly _expectInput: GGExpectations<RequestBody> = new GGExpectations()
    private _expectError: ConstructorOf<ErrorsUnion>
    private readonly _expectOutput: GGExpectations<ResponseData> = new GGExpectations()

    private activeExpect: GGExpectations<any>;

    private _sleep: number;
    private _times: number = 1;

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
            expectError: this._expectError
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
    public times(amount: number): this {
        this._times = amount;
        return this;
    }

    public get response(): GGSpyWith<ResponseData, never, never> {
        this.activeExpect = this._expectOutput;
        this._expectOutput.flush();
        return this as any;
    }

    public toBeError<Type extends ConstructorOf<ErrorsUnion>>(type: Type): GGSpyWith<Extract<ErrorsUnion, InstanceType<Type>>, never, never> {
        this._expectError = type;
        this._expectOutput.flush();
        return this as any;
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
