import {GGCallInterceptor, GGCallInterceptorConfig, GGMockWith, GGSpyWith, GGTestRunner} from "@grest-ts/testkit"
import {GGHttpInterceptorsServer} from "./GGHttpInterceptorsServer";
import {parseContractResponse} from "../utils/validateContractResponse";
import {HttpMethod} from "@grest-ts/common";
import {GGHttpCodec, GGHttpSchema} from "../../src/schema/GGHttpSchema";
import {GGContractApiDefinition} from "@grest-ts/schema";

declare module "../../src/schema/GGHttpSchema" {
    interface GGHttpSchema<TContract extends GGContractApiDefinition> {
        readonly mock: ApiMockMethods<TContract>
        readonly spy: ApiSpyMethods<TContract>
    }
}

type ApiMockMethods<TContract> = {
    readonly [K in keyof TContract]: GGMockWith
}

type ApiSpyMethods<TContract> = {
    readonly [K in keyof TContract]: GGSpyWith
}

Object.defineProperty(GGHttpSchema.prototype, 'mock', {
    get(this: GGHttpSchema<any>) {
        const name = this.name;
        const methods = this.codec;
        const fullPathPrefix = "/" + this.pathPrefix + "/"
        return new Proxy({}, {
            get(_target, prop: string) {
                const methodDef: GGHttpCodec = methods[prop]
                if (!methodDef) {
                    return undefined
                }
                return new GGMockWith(GGHttpInterceptor, {
                    apiName: name,
                    method: methodDef.method,
                    pathPrefix: fullPathPrefix,
                    pathSuffix: methodDef.path
                });
            }
        })
    },
    enumerable: false,
    configurable: true
})

Object.defineProperty(GGHttpSchema.prototype, 'spy', {
    get(this: GGHttpSchema<any>) {
        const fullPathPrefix = "/" + this.pathPrefix + "/"
        const name = this.name;
        const methods = this.codec;
        return new Proxy({}, {
            get(_target, prop: string) {
                const methodDef: GGHttpCodec = methods[prop]
                if (!methodDef) {
                    return undefined
                }
                return new GGSpyWith(GGHttpInterceptor, {
                    apiName: name,
                    method: methodDef.method,
                    pathPrefix: fullPathPrefix,
                    pathSuffix: methodDef.path
                })
            }
        })
    },
    enumerable: false,
    configurable: true
})

export interface HttpInterceptorConfig extends GGCallInterceptorConfig {
    method: HttpMethod;
    apiName: string;
    pathPrefix: string;
    pathSuffix: string;
    expectError?: any;
}

export class GGHttpInterceptor extends GGCallInterceptor {

    public readonly method: HttpMethod;
    public readonly apiName: string;
    public readonly pathPrefix: string;
    public readonly pathSuffix: string;
    protected readonly expectError?: any;

    constructor(test: GGTestRunner, config: HttpInterceptorConfig) {
        super(test, config);
        this.method = config.method;
        this.apiName = config.apiName;
        this.pathPrefix = config.pathPrefix;
        this.pathSuffix = config.pathSuffix;
        this.expectError = config.expectError;
    }

    public getKey(): string {
        return `${this.method} ${this.pathPrefix}${this.pathSuffix}`;
    }

    protected doRegister(): void {
        this.test.getExtensionInstance(GGHttpInterceptorsServer).addInterceptor(this);
    }

    protected doUnregister(): void {
        this.test.getExtensionInstance(GGHttpInterceptorsServer).deleteInterceptor(this);
    }

    protected parseResponseData(result: any): any {
        return parseContractResponse(result, this.expectError);
    }
}
