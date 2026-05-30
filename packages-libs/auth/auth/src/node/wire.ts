import {GGContextKey} from "@grest-ts/context"
import {IsString} from "@grest-ts/schema"
import {header, type GGHeaderBinding} from "@grest-ts/http"

export class HeaderTokenKey extends GGContextKey<string | undefined> {

    public readonly wire: GGHeaderBinding

    constructor(name: string, wireOptions: {name?: string; scheme?: "bearer"}, options?: {description?: string}) {
        super(name, IsString.orUndefined, options)
        this.wire = header(this, wireOptions)
    }
}
