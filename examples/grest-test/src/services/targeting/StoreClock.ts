import {mockable} from "@grest-ts/testkit-runtime"

@mockable
export class StoreClock {

    async stamp(): Promise<string> {
        return "real"
    }
}
