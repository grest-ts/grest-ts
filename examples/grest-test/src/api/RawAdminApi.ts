import {GGRawWebSocketSchema} from "@grest-ts/websocket"
import {GGRawSocketContract, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"
import {WS_SESSION} from "./WsCookieApi"
import {AppPermission} from "./PermissionsApi"

/**
 * Raw socket gated by a connect-level permission. The WS_SESSION cookie wire resolves
 * scopes at the handshake; connect.permission asserts Admin before the stream opens —
 * exercising the same permission gate a schema socket uses, on the raw path.
 */
export const RawAdminApiContract = new GGRawSocketContract("RawAdminApi", {
    connect: {
        permission: AppPermission.Admin,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
    },
})

export const RawAdminApi = new GGRawWebSocketSchema({
    contract: RawAdminApiContract,
    path: "ws/raw-admin",
    use: [WS_SESSION],
})
