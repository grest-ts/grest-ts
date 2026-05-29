import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {ACCESS, AccountWsIncoming, AccountWsOutgoing, LOCALE} from "./Account"

type Incoming = WebSocketIncoming<AccountWsIncoming>
type Outgoing = WebSocketOutgoing<AccountWsOutgoing>

// A token "tok-alice" identifies user "alice"; anything else (or absent) is unauthenticated.
const userFromAccess = (): string | undefined => {
    const t = ACCESS.get()
    return t?.startsWith("tok-") ? t.slice(4) : undefined
}

// One implementation behind all four wirings. It reads ACCESS/LOCALE and never knows or
// cares whether they arrived via header or cookie, HTTP or WebSocket.
export class AccountService {

    public whoami = async (): Promise<{user: string; locale: string}> => {
        const user = userFromAccess()
        if (!user) throw new NOT_AUTHORIZED()
        return {user, locale: LOCALE.get() ?? "en"}
    }

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing): void => {
        incoming.on({whoami: this.whoami})
    }
}
