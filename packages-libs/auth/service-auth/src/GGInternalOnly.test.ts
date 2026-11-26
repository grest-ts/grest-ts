import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGInternalOnly} from "./GGInternalOnly"

function arrivingAt(host: string | undefined): () => void {
    return () => GGInternalOnly.parse?.({headers: {host}, query: {}})
}

describe("GGInternalOnly", () => {
    test.each(["localhost", "localhost:8080", "127.0.0.1:3000", "[::1]:80", "hub.internal.example.com", "Hub.Internal.example.com:443"])("lets %s through", host => {
        expect(arrivingAt(host)).not.toThrow()
    })

    test.each(["api.example.com", "internal.example.com", "hub.internal", "evil.com.internal.example", "a.b.internal.example.com", ""])("refuses %s", host => {
        expect(arrivingAt(host)).toThrow(NOT_AUTHORIZED)
    })

    test("refuses a request without a host", () => {
        expect(arrivingAt(undefined)).toThrow(NOT_AUTHORIZED)
    })
})
