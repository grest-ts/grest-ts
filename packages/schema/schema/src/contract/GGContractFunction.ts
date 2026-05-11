import {GGPromise} from "./GGPromise";
import {GGContractExecutor} from "./GGContractExecutor";
import {GGContractClientMethod, GGContractImplementationMethod, GGContractMethod} from "./GGContractClass";
import {FORBIDDEN, NOT_AUTHORIZED} from "./standardErrors";
import {GG_NO_PERMISSIONS} from "./permission/GGPermission";
import {validatePermission} from "./permission/validatePermission";

export class GGContractFunction<Method extends GGContractMethod> {

    public readonly method: Method

    constructor(method: Method) {
        this.method = method;
        validatePermission(method.permission, "permission");
        if (method.permission !== GG_NO_PERMISSIONS) {
            const errs = method.errors ?? [];
            if (!errs.includes(NOT_AUTHORIZED as any) || !errs.includes(FORBIDDEN as any)) {
                throw new Error(
                    `Contract function has a non-public permission but its 'errors' array must include both NOT_AUTHORIZED and FORBIDDEN`
                );
            }
        }
        Object.freeze(this);
        Object.freeze(this.method);
    }

    public implement(handler: GGContractImplementationMethod<Method>): GGContractClientMethod<Method> {
        const method = this.method;
        return ((data: any) => new GGPromise(GGContractExecutor.call(method, data, undefined, handler))) as any;
    }
}
