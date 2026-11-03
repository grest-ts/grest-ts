import {GGConfigKey} from "../GGConfigKey";
import {GGValidator} from "@grest-ts/schema";

export class GGSecret<T> extends GGConfigKey<T> {

    public static readonly NAME = "[GGSecret]";

    constructor(name: string, schema: GGValidator<T>, description: string) {
        super(name, schema, description);
    }

    public getStoreKey(): string {
        return GGSecret.NAME
    }

    public reveal(): T {
        return this.getValue();
    }

}
