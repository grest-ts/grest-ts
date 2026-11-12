import {mockable} from "@grest-ts/testkit-runtime"
import {ERROR, IsObject, IsString} from "@grest-ts/schema"

export const UPSTREAM_REFUSED = ERROR.badRequest("UPSTREAM_REFUSED", IsObject({reason: IsString}))

@mockable
export class Upstream {

    async lookup(input: {id: string}): Promise<string> {
        return "real:" + input.id
    }

    async tagged({id, tag}: {id: string, tag: string}): Promise<string> {
        return `real:${id}:${tag}`
    }

    async pair(id: string, count: number): Promise<string> {
        return `real:${id}x${count}`
    }

    async named(id: string): Promise<string> {
        return "real:" + id
    }

    field = async (id: string): Promise<string> => "real:" + id
}
