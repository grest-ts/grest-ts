import {GGConfigKey} from "../GGConfigKey";
import {GGValidator} from "@grest-ts/schema";

export class GGResource<T> extends GGConfigKey<T> {

    public static readonly NAME = "[GGResource]";

    constructor(name: string, schema: GGValidator<T>, description: string) {
        super(name, schema, description);
    }

    public getStoreKey(): string {
        return GGResource.NAME;
    }

    public get(): T {
        return this.getValue();
    }

}
