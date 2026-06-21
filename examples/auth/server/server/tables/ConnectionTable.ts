import {GGContractClient} from "@grest-ts/schema"
import {WebSocketOutgoing} from "@grest-ts/websocket"
import {LiveApiContract} from "../../../api/LiveApi"
import {tUserId} from "../../../api/auth/UserAuth"

export type OutgoingConnection = WebSocketOutgoing<GGContractClient<typeof LiveApiContract.methods["serverToClient"]>>

export class ConnectionTable {
    private readonly connections = new Map<tUserId, Set<OutgoingConnection>>()

    public add(userId: tUserId, conn: OutgoingConnection): void {
        if (!this.connections.has(userId)) {
            this.connections.set(userId, new Set())
        }
        this.connections.get(userId)!.add(conn)
    }

    public remove(userId: tUserId, conn: OutgoingConnection): void {
        const userConns = this.connections.get(userId)
        if (!userConns) return
        userConns.delete(conn)
        if (userConns.size === 0) this.connections.delete(userId)
    }

    public getAll(userId: tUserId): Set<OutgoingConnection> | undefined {
        return this.connections.get(userId)
    }

    public forEachAll(cb: (conn: OutgoingConnection) => void): void {
        this.connections.forEach(conns => conns.forEach(cb))
    }
}
