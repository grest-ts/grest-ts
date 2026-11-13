import {GGRuntime} from "@grest-ts/runtime"
import {composeAddressingRelay} from "./services/addressing/AddressingRelay"

export class AddressingRelayBRuntime extends GGRuntime {
    public static readonly NAME = "addressingRelayB"

    protected compose(): void {
        composeAddressingRelay("127.0.0.3")
    }
}

AddressingRelayBRuntime.cli(import.meta.url).then()
