import {WsCookieApi, WS_SESSION_VALUE} from "../api/WsCookieApi"

export class WsCookieService {

    public handleConnection = (incoming: typeof WsCookieApi.clientToServer, _outgoing: typeof WsCookieApi.serverToClient): void => {
        incoming.on({
            whoami: async () => WS_SESSION_VALUE.get(),
            adminOnly: async () => "admin-ok",
        })
    }
}
