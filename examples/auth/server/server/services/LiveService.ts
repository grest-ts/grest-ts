import {GGContractImplementation} from "@grest-ts/schema"
import {WebSocketIncoming} from "@grest-ts/websocket"
import {LiveApiContract} from "../../../api/LiveApi"
import {BannerState} from "../../../api/BannerApi"
import {User} from "../../../api/auth/UserAuth"
import {USER_DATA} from "../auth/UserAuthHandler"
import {UserService} from "./UserService"
import {BannerService} from "./BannerService"
import {ConnectionTable, OutgoingConnection} from "../tables/ConnectionTable"

type IncomingHandler = WebSocketIncoming<GGContractImplementation<typeof LiveApiContract.methods["clientToServer"]>>

export class LiveService {
    private readonly connections = new ConnectionTable()

    constructor(userService: UserService, bannerService: BannerService) {
        userService.setOnProfileUpdatedCallback(user => this.broadcastProfileUpdate(user))
        bannerService.setOnClickedCallback(state => this.broadcastBannerPong(state))
    }

    public handleConnection = (incoming: IncomingHandler, outgoing: OutgoingConnection): void => {
        const user = USER_DATA.get()!
        this.connections.add(user.id, outgoing)

        incoming.on({
            ping: async (): Promise<void> => {
                outgoing.pong({username: USER_DATA.get()!.username, timestamp: Date.now()})
            },
            // Permission already gated by the framework — only CAN_SEE_RED_BANNER reaches here.
            bannerPing: async (): Promise<void> => {
                this.broadcastBannerPong({count: 0, username: USER_DATA.get()!.username})
            },
        })

        outgoing.onClose(() => {
            this.connections.remove(user.id, outgoing)
        })
    }

    private broadcastProfileUpdate(user: User): void {
        this.connections.getAll(user.id)?.forEach(
            conn => conn.profileUpdated({username: user.username, email: user.email})
        )
    }

    broadcastBannerPong(state: BannerState): void {
        this.connections.forEachAll(conn => conn.bannerPong({count: state.count, username: state.username}))
    }
}
