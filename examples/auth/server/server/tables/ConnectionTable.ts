import {LiveApi} from "../../../api/LiveApi"
import {tUserId} from "../../../api/auth/UserAuth"

export class ConnectionTable {
    private readonly connections = new Map<tUserId, Set<typeof LiveApi.serverToClient>>()

    public add(userId: tUserId, conn: typeof LiveApi.serverToClient): void {
        if (!this.connections.has(userId)) {
            this.connections.set(userId, new Set())
        }
        this.connections.get(userId)!.add(conn)
    }

    public remove(userId: tUserId, conn: typeof LiveApi.serverToClient): void {
        const userConns = this.connections.get(userId)
        if (!userConns) return
        userConns.delete(conn)
        if (userConns.size === 0) this.connections.delete(userId)
    }

    public getAll(userId: tUserId): Set<typeof LiveApi.serverToClient> | undefined {
        return this.connections.get(userId)
    }

    public forEachAll(cb: (conn: typeof LiveApi.serverToClient) => void): void {
        this.connections.forEach(conns => conns.forEach(cb))
    }
}
