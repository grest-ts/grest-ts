import {GGContractClient, GGContractImplementation} from "@grest-ts/schema"
import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {LiveApiContract} from "../../../api/LiveApi"
import {BannerState} from "../../../api/BannerApi"
import {User, UserContext, tUserId} from "../../../api/auth/UserAuth"
import {UserService} from "./UserService"
import {BannerService} from "./BannerService"

type IncomingHandler = WebSocketIncoming<GGContractImplementation<typeof LiveApiContract.methods["clientToServer"]>>
type OutgoingConnection = WebSocketOutgoing<GGContractClient<typeof LiveApiContract.methods["serverToClient"]>>

export class LiveService {
    private readonly connections = new Map<tUserId, Set<OutgoingConnection>>()

    constructor(userService: UserService, bannerService: BannerService) {
        userService.setOnProfileUpdatedCallback(user => this.broadcastProfileUpdate(user))
        bannerService.setOnClickedCallback(state => this.broadcastBannerPong(state))
    }

    public handleConnection = (incoming: IncomingHandler, outgoing: OutgoingConnection): void => {
        const user = UserContext.get()!
        if (!this.connections.has(user.id)) this.connections.set(user.id, new Set())
        this.connections.get(user.id)!.add(outgoing)

        incoming.on({
            ping: async (): Promise<void> => {
                outgoing.pong({username: UserContext.get()!.username, timestamp: Date.now()})
            },
            // Permission already gated by the framework — only CAN_SEE_RED_BANNER reaches here.
            bannerPing: async (): Promise<void> => {
                this.broadcastBannerPong({count: 0, username: UserContext.get()!.username})
            },
        })

        outgoing.onClose(() => {
            const conns = this.connections.get(user.id)
            if (conns) {
                conns.delete(outgoing)
                if (conns.size === 0) this.connections.delete(user.id)
            }
        })
    }

    private broadcastProfileUpdate(user: User): void {
        this.connections.get(user.id)?.forEach(
            conn => conn.profileUpdated({username: user.username, email: user.email})
        )
    }

    broadcastBannerPong(state: BannerState): void {
        this.connections.forEach(conns =>
            conns.forEach(conn => conn.bannerPong({count: state.count, username: state.username}))
        )
    }
}
