import {GGContextKey, type GGTransportMiddleware} from "@grest-ts/context"
import {IsString} from "@grest-ts/schema"
import {GGHeader} from "@grest-ts/http"

export class HeaderTokenKey extends GGContextKey<string | undefined> {

    public readonly wire: GGTransportMiddleware

    constructor(name: string, wireOptions: {name?: string; scheme?: "bearer"}, options?: {description?: string}) {
        super(name, IsString.orUndefined, options)
        this.wire = GGHeader.middleware(this, wireOptions)
    }
}
