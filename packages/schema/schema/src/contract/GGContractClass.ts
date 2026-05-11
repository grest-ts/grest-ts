import {GGContractExecutor, GGContractExecutorOptions} from "./GGContractExecutor";
import {ANY_ERROR, ANY_ERROR_CLS, SERVER_ERROR} from "./ERROR";
import {GGSchema} from "../GGSchema";
import {GGPromise} from "./GGPromise";
import {FORBIDDEN, NOT_AUTHORIZED, VALIDATION_ERROR} from "./standardErrors";
import {GG_NO_PERMISSIONS, GGPermission} from "./permission/GGPermission";
import {validatePermission} from "./permission/validatePermission";

export interface GGContractMethod<Request = any, Response = any, ErrorsUnion extends ANY_ERROR_CLS = any> {
    input?: GGSchema<Request>
    success?: GGSchema<Response>;
    errors?: ErrorsUnion[];
    permission: GGPermission;
}

export type GGContractApiDefinition = Record<string, GGContractMethod>

export type GGContractImplementation<ContractMethods extends Record<string, GGContractMethod>> = {
    [K in keyof ContractMethods]: GGContractImplementationMethod<ContractMethods[K]>
}

export type GGContractImplementationMethod<Method> = Method extends { input: { infer: infer I }, success: { infer: infer O } }
    ? (data: I) => Promise<O>
    : Method extends { success: { infer: infer O } }
        ? () => Promise<O>
        : Method extends { input: { infer: infer I } }
            ? (data: I) => Promise<void>
            : () => Promise<void>

export type GGContractClient<ContractMethods extends GGContractApiDefinition> = {
    [K in keyof ContractMethods]: GGContractClientMethod<ContractMethods[K]>
}

export type GGContractClientMethod<Method> = Method extends { input: { infer: infer I }, success: { infer: infer O } }
    ? (data: I) => GGPromise<O, GGContractMethodErrors<Method> | typeof SERVER_ERROR.infer | typeof VALIDATION_ERROR.infer>
    : Method extends { success: { infer: infer O } }
        ? () => GGPromise<O, GGContractMethodErrors<Method> | typeof SERVER_ERROR.infer>
        : Method extends { input: { infer: infer I } }
            ? (data: I) => GGPromise<void, GGContractMethodErrors<Method> | typeof SERVER_ERROR.infer>
            : () => GGPromise<void, typeof SERVER_ERROR.infer>

export type GGContractMethodErrors<Method> = Method extends { errors: infer E }
    ? E extends { infer: infer F }[]
        ? F extends ANY_ERROR
            ? F
            : never
        : never
    : never;

export class GGContractClass<ContractMethods extends GGContractApiDefinition> {

    public readonly name: string
    public readonly methods: ContractMethods
    declare readonly infer: GGContractImplementation<ContractMethods>

    constructor(name: string, methods: ContractMethods) {
        this.name = name;
        this.methods = methods;
        for (const methodName in this.methods) {
            const method = this.methods[methodName];
            validatePermission(method.permission, `${name}.${methodName}.permission`);
            if (method.permission !== GG_NO_PERMISSIONS) {
                const errs = method.errors ?? [];
                if (!errs.includes(NOT_AUTHORIZED as any) || !errs.includes(FORBIDDEN as any)) {
                    throw new Error(
                        `Contract ${name}.${methodName} has a non-public permission but its 'errors' array must include both NOT_AUTHORIZED and FORBIDDEN`
                    );
                }
            }
            Object.freeze(method);
        }
        Object.freeze(this);
    }

    public create<Args extends any[]>(
        factory: (
            $: (impl: GGContractImplementation<ContractMethods>) => GGContractImplementation<ContractMethods>,
            ...args: Args
        ) => GGContractImplementation<ContractMethods>,
    ): (...args: Args) => GGContractImplementation<ContractMethods> {
        const validate: (impl: GGContractImplementation<ContractMethods>) => GGContractImplementation<ContractMethods> = impl => impl
        return (...args: Args) => factory(validate, ...args)
    }

    public implement(
        instance: GGContractImplementation<ContractMethods>,
        options?: GGContractExecutorOptions
    ): GGContractClient<ContractMethods> {
        const client: any = {};
        for (const methodName in this.methods) {
            if (!instance[methodName]) throw new Error("Handler missing for " + this.name + "." + methodName)
            const contractFnDef = this.methods[methodName];
            client[methodName] = (data: any) => {
                return new GGPromise(GGContractExecutor.call(contractFnDef, data, options, async (data) => {
                    return (instance[methodName] as any)(data)
                }))
            }
        }
        return client;
    }
}
