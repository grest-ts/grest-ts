import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGLocatorKey} from "@grest-ts/locator"
import {AddressingRelayApi, AddressingRelayInfoApi} from "../../api/AddressingApi"
import {selfSignedCert} from "./selfSignedCert"

/** A relay as kratt runs one per VM: its own IP, a self-signed certificate, reached by address and pin, not by discovery. */
export function composeAddressingRelay(host: string): void {
    const {cert, key, fingerprint256} = selfSignedCert(host)
    const tlsServer = new GGHttpServer({host, tls: {cert, key}})
    new GGHttp(tlsServer).http(AddressingRelayApi, {
        sync: async ({branch}: {branch: string}) => ({branch, by: "real:" + host}),
    })
    new GGHttp(new GGHttpServer({key: new GGLocatorKey("addressing-relay-info")})).http(AddressingRelayInfoApi, {
        target: async () => ({host, port: tlsServer.port!, fingerprint256, ca: undefined}),
    })
}
