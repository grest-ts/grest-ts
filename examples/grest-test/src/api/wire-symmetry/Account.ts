import {GGContextKey} from "@grest-ts/context"
import {GGCookie, GGHeader} from "@grest-ts/http"
import {defineSocketContract} from "@grest-ts/websocket"
import {GGContractClass, GGContractClient, GGContractImplementation, GG_NO_PERMISSIONS, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"

// Two context keys the service reads, identically, no matter how the value arrived.
// ACCESS is treated as a credential; LOCALE is just a value — "auth" is what the consumer
// does with it, not a property of the wire.
export const ACCESS = new GGContextKey<string | undefined>("access", IsString.orUndefined)
export const LOCALE = new GGContextKey<string | undefined>("locale", IsString.orUndefined)

// Four bindings over those two keys. header vs cookie is the ONLY thing that differs —
// each binding works on both HTTP and WebSocket via a single .use(...).
export const accessViaHeader = new GGHeader("authorization", ACCESS, {scheme: "bearer"})
export const accessViaCookie = new GGCookie("access", ACCESS)
export const localeViaHeader = new GGHeader("x-locale", LOCALE)
export const localeViaCookie = new GGCookie("locale", LOCALE)

// One logical contract, reused verbatim across all four wirings. Distinct names only so
// routing/discovery can tell the four registrations apart on one server.
const whoami = {
    success: IsObject({user: IsString, locale: IsString}),
    errors: [NOT_AUTHORIZED, SERVER_ERROR],
    permission: GG_NO_PERMISSIONS,
}

export const AccountHttpHeaderContract = new GGContractClass("WireAccountHttpHeader", {whoami})
export const AccountHttpCookieContract = new GGContractClass("WireAccountHttpCookie", {whoami})
export const AccountWsHeaderContract = defineSocketContract("WireAccountWsHeader", {clientToServer: {whoami}, serverToClient: {}})
export const AccountWsCookieContract = defineSocketContract("WireAccountWsCookie", {clientToServer: {whoami}, serverToClient: {}})

export type AccountWsIncoming = GGContractImplementation<typeof AccountWsHeaderContract.methods["clientToServer"]>
export type AccountWsOutgoing = GGContractClient<typeof AccountWsHeaderContract.methods["serverToClient"]>
