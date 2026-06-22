import type {GGRawSocket} from "@grest-ts/websocket"
import {SERVER_AUTHED_USER} from "../api/AuthedSocketApi"

/**
 * Reads the authenticated principal in onConnection (proving auth context is available
 * after the raw handshake), then echoes every inbound frame back prefixed with the
 * username and room — proving the byte stream and the query both made it through.
 */
export class RawEchoService {

    public handleConnection = (socket: GGRawSocket, query: {room: string}): void => {
        const user = SERVER_AUTHED_USER.assert()
        socket.onMessage((data) => {
            socket.send(`${user.username}@${query.room}:${data.toString()}`)
        })
    }
}
