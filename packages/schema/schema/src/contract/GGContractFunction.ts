import {GGPromise} from "./GGPromise";
import {GGContractExecutor} from "./GGContractExecutor";
import {GGContractClientMethod, GGContractImplementationMethod, GGContractMethod} from "./GGContractClass";

export class GGContractFunction<Method extends GGContractMethod> {

    public readonly method: Method

    constructor(method: Method) {
        this.method = method;
        Object.freeze(this);
        Object.freeze(this.method);
    }

    public implement(handler: GGContractImplementationMethod<Method>): GGContractClientMethod<Method> {
        const method = this.method;
        return ((data: any) => new GGPromise(GGContractExecutor.call(method, data, undefined, handler))) as any;
    }
}
