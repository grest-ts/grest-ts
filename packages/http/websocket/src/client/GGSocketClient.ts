import {GGSocket} from "../socket/GGSocket";
import {GGContractMethod} from "@grest-ts/schema";

export abstract class GGSocketClient {

    public readonly socket: GGSocket

    constructor(socket: GGSocket) {
        this.socket = socket;
    }

    public onClose(onClose: () => void) {
        this.socket.onClose(onClose)
        return this
    }

    public close(): void {
        this.socket.close()
    }

    public __defineApi<T extends Record<string, GGContractMethod<any, any, any>>>(api: T): T {
        return api;
    }

}
