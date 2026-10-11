import {GGContextKey, type GGInbound, type GGTransportMiddleware} from "@grest-ts/context"
import {FORBIDDEN, IsString} from "@grest-ts/schema"

/**
 * True for an IPv4/IPv6 loopback peer address as Node reports it: `127.0.0.0/8`, `::1`, or an
 * IPv4-mapped loopback (`::ffff:127.x.x.x`). `undefined`/empty is not loopback — a guard that
 * can't tell where the peer is must fail closed.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
    if (!address) return false
    if (address === "::1") return true
    const v4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address
    return v4.startsWith("127.")
}

/**
 * A transport middleware that rejects any request whose peer is not on the loopback interface
 * (`FORBIDDEN`). Add it to a schema's `use: [...]` to make an endpoint local-only on a server
 * that binds a public interface — the fix for "this is only ever called by in-VM tooling, so it
 * doesn't need a token" that otherwise rests on an unenforced assumption. Peer address comes from
 * the connection (`GGInbound.peerAddress`), never a client header, so it can't be spoofed.
 *
 *   export const GG_LOOPBACK = new GGLoopbackGuard("loopback")
 *   // schema: use: [GG_LOOPBACK]
 *
 * It is not a credential wire: there is nothing to verify or mint, no `.define()`/`.create()`.
 * Browser-safe — the gate only runs server-side (parse/process); the client contributes nothing.
 */
export class GGLoopbackGuard extends GGContextKey<string | undefined> implements GGTransportMiddleware {

    constructor(name: string) {
        super(name, IsString.orUndefined)
    }

    public parse(inbound: GGInbound): void {
        this.set(inbound.peerAddress)
    }

    public async process(): Promise<void> {
        if (!isLoopbackAddress(this.get())) {
            throw new FORBIDDEN({debugMessage: "Loopback-only endpoint: peer is not on the loopback interface"})
        }
    }
}

/** Shared stateless loopback gate — add to a schema's `use: [...]`. */
export const GG_LOOPBACK = new GGLoopbackGuard("loopback")
