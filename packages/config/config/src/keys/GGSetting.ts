import {GGConfigKey, Widen} from "../GGConfigKey";
import {deepFreeze} from "@grest-ts/common";
import {GGValidator} from "@grest-ts/schema";

export class GGSetting<T> extends GGConfigKey<T> {

    public static readonly NAME = "[GGSetting]";

    readonly #default: T;

    constructor(name: string, schema: GGValidator<T>, defaultValue: Widen<T>, description: string) {
        super(name, schema, description);
        this.#default = deepFreeze(defaultValue as T);
    }

    public override getDefault(): T {
        return this.#default;
    }

    public getStoreKey(): string {
        return GGSetting.NAME
    }

    public get(): T {
        return this.getValue();
    }

}
