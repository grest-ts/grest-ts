import {rawSocketSchema} from "@grest-ts/websocket"
import {WS_SESSION} from "./WsCookieApi"
import {AppPermission} from "./PermissionsApi"

/**
 * Raw socket gated by a connect-level permission. The WS_SESSION cookie wire resolves
 * scopes at the handshake; `connectPermission` asserts Admin before the stream opens —
 * exercising the same permission gate a schema socket uses, on the raw path.
 */
export const RawAdminApi = rawSocketSchema("RawAdminApi", {
    path: "ws/raw-admin",
    use: [WS_SESSION],
    connectPermission: AppPermission.Admin,
})
