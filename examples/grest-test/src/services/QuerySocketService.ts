import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {GGContractClient, GGContractImplementation} from "@grest-ts/schema"
import {QueryArgs, QuerySocketApiContract} from "../api/QuerySocketApi"

type Incoming = WebSocketIncoming<GGContractImplementation<typeof QuerySocketApiContract.methods["clientToServer"]>>
type Outgoing = WebSocketOutgoing<GGContractClient<typeof QuerySocketApiContract.methods["serverToClient"]>>

export class QuerySocketService {

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing, query: QueryArgs): void => {
        incoming.on({
            echoRoom: async () => `${query.room}@${query.version}`,
        })
    }
}
