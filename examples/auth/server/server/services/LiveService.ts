import {GGContractClient, GGContractImplementation} from "@grest-ts/schema"
import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {LiveApiContract} from "../../../api/LiveApi"
import {User, tUserId} from "../../../api/auth/UserAuth"
import {UserContext} from "../UserContext"
import {UserService} from "./UserService"

type IncomingHandler = WebSocketIncoming<GGContractImplementation<typeof LiveApiContract.methods["clientToServer"]>>
type OutgoingConnection = WebSocketOutgoing<GGContractClient<typeof LiveApiContract.methods["serverToClient"]>>

export class LiveService {
    private readonly connections = new Map<tUserId, Set<OutgoingConnection>>()

    constructor(userService: UserService) {
        userService.setOnProfileUpdatedCallback((user) => {
            this.broadcastProfileUpdate(user)
        })
    }

    public handleConnection = (incoming: IncomingHandler, outgoing: OutgoingConnection): void => {
        const user = UserContext.get()!

        if (!this.connections.has(user.id)) {
            this.connections.set(user.id, new Set())
        }
        this.connections.get(user.id)!.add(outgoing)

        incoming.on({
            ping: async (): Promise<void> => {
                outgoing.pong({username: UserContext.get()!.username, timestamp: Date.now()})
            },
        })

        outgoing.onClose(() => {
            const userConns = this.connections.get(user.id)
            if (userConns) {
                userConns.delete(outgoing)
                if (userConns.size === 0) this.connections.delete(user.id)
            }
        })
    }

    private broadcastProfileUpdate(user: User): void {
        const conns = this.connections.get(user.id)
        if (conns) {
            conns.forEach(conn => conn.profileUpdated({username: user.username, email: user.email}))
        }
    }
}
