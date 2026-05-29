import {GGRpc, httpSchema} from "@grest-ts/http"
import {webSocketSchema} from "@grest-ts/websocket"
import {
    AccountHttpCookieContract,
    AccountHttpHeaderContract,
    AccountWsCookieContract,
    AccountWsHeaderContract,
    accessViaCookie,
    accessViaHeader,
    localeViaCookie,
    localeViaHeader,
} from "./Account"

// Only the bindings differ between these — the contract, routes, and (at registration)
// the service instance are identical.
export const AccountHttpHeader = httpSchema(AccountHttpHeaderContract)
    .pathPrefix("wire/h")
    .use(accessViaHeader)
    .use(localeViaHeader)
    .routes({whoami: GGRpc.GET("whoami")})

export const AccountHttpCookie = httpSchema(AccountHttpCookieContract)
    .pathPrefix("wire/c")
    .use(accessViaCookie)
    .use(localeViaCookie)
    .routes({whoami: GGRpc.GET("whoami")})

export const AccountWsHeader = webSocketSchema(AccountWsHeaderContract)
    .path("wire-ws/h")
    .use(accessViaHeader)
    .use(localeViaHeader)
    .done()

export const AccountWsCookie = webSocketSchema(AccountWsCookieContract)
    .path("wire-ws/c")
    .use(accessViaCookie)
    .use(localeViaCookie)
    .done()
