import {GGSocketBroadcast} from "@grest-ts/websocket"
import {BroadcastSocketApi} from "../api/BroadcastSocketApi"

export class BroadcastSocketService {

    private readonly values: number[] = []
    private readonly broadcast = new GGSocketBroadcast(BroadcastSocketApi)

    public handleConnection = (incoming: typeof BroadcastSocketApi.clientToServer, outgoing: typeof BroadcastSocketApi.serverToClient): void => {
        incoming.on({
            requestSnapshot: ({delayMs, fail}) => this.broadcast.join(outgoing, async o => {
                const values = [...this.values]
                await new Promise(resolve => setTimeout(resolve, delayMs ?? 0))
                if (fail) throw new Error("seed failed")
                o.onSnapshot({values})
            }),
            publish: async ({value}) => {
                this.values.push(value)
                this.broadcast.out.onValue({value})
            },
        })
    }
}
