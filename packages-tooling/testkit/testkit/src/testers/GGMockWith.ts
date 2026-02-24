import {DeepPartial} from "@grest-ts/common";
import {captureStackSourceFile} from "../utils/captureStack";
import {GGExpectations} from "../utils/GGExpectations";
import {Raw} from "@grest-ts/schema";
import {GG_TEST_RUNNER, GGTestRunner} from "../GGTestRunner";
import {IGGTestWith} from "./IGGTestWith";
import {IGGTestInterceptor} from "./IGGTestInterceptor";
import {GGCallInterceptor, GGCallInterceptorConfig} from "./GGCallInterceptor";

type InterceptorFactory = new (runner: GGTestRunner, config: any) => GGCallInterceptor;

export class GGMockWith<RequestBody = any, ResponseData = any, ErrorsUnion = any> implements IGGTestWith {

    private readonly interceptorFactory: InterceptorFactory;
    private readonly interceptorConfig: Record<string, any>;
    private readonly definedInSourceFile: string;
    private _sleep: number;
    private _times: number = 1;

    private readonly expectations: GGExpectations<RequestBody> = new GGExpectations();
    private returnData: ResponseData | ErrorsUnion | (() => ResponseData | ErrorsUnion);

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
            passThrough: false,
            inputExpectations: this.expectations,
            returnData: this.returnData
        };
        return new this.interceptorFactory(test, config);
    }

    public sleep(timeMs: number): this {
        this._sleep = timeMs;
        return this;
    }

    public times(amount: number): this {
        this._times = amount;
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

    public andReturn(data: Raw<ResponseData | ErrorsUnion> | (() => Raw<ResponseData | ErrorsUnion>)): this {
        this.returnData = data as any;
        return this;
    }

    public requiresWaitFor(): boolean {
        return this.interceptorConfig.requiresWaitFor === true;
    }

}
