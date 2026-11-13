import {GGRuntime} from "@grest-ts/runtime"
import {composeAddressingRelay} from "./services/addressing/AddressingRelay"

export class AddressingRelayARuntime extends GGRuntime {
    public static readonly NAME = "addressingRelayA"

    protected compose(): void {
        composeAddressingRelay("127.0.0.2")
    }
}

AddressingRelayARuntime.cli(import.meta.url).then()
