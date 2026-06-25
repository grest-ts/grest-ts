import {QueryArgs, QuerySocketApi} from "../api/QuerySocketApi"

type Incoming = typeof QuerySocketApi.clientToServer
type Outgoing = typeof QuerySocketApi.serverToClient

export class QuerySocketService {

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing, query: QueryArgs): void => {
        incoming.on({
            echoRoom: async () => `${query.room}@${query.version}`,
        })
    }
}
