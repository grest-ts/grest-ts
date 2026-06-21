import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {GGContractClient, GGContractImplementation} from "@grest-ts/schema"
import {QueryArgs, QuerySocketApiMethods} from "../api/QuerySocketApi"

type Incoming = WebSocketIncoming<GGContractImplementation<typeof QuerySocketApiMethods["clientToServer"]>>
type Outgoing = WebSocketOutgoing<GGContractClient<typeof QuerySocketApiMethods["serverToClient"]>>

export class QuerySocketService {

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing, query: QueryArgs): void => {
        incoming.on({
            echoRoom: async () => `${query.room}@${query.version}`,
        })
    }
}
