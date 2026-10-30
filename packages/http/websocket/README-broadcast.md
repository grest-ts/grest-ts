# WebSocket Broadcast

`GGSocketBroadcast` pushes the same server→client message to every subscribed client — for live
views of shared server state (dashboards, lists, status panels). It reaches the connections of this
process, as one audience; see [Scope](#scope).

## Basic Broadcast

```typescript
import {GGSocketBroadcast} from "@grest-ts/websocket"

export class OrderEvents {
    private readonly broadcast = new GGSocketBroadcast(OrderEventsSocket)

    handleConnection = (incoming: typeof OrderEventsSocket.clientToServer, outgoing: typeof OrderEventsSocket.serverToClient): void => {
        void this.broadcast.join(outgoing)
    }

    orderChanged(order: Order): void {
        this.broadcast.out.onOrder({order})
    }
}
```

* A connection stays a member until it closes.
* `out` is fire-and-forget: a failed send to one connection is logged, the others still get it.

## Snapshot + Delta

Pass a `seed` to `join` to send the full state first, then only changes. Let the client trigger it
with its own contract method (`requestSnapshot` here), sent after it has registered its handlers —
so the snapshot can't arrive before anything listens:

```typescript
// server
incoming.on({
    requestSnapshot: () => this.broadcast.join(outgoing, async o => o.onSnapshot({orders: await this.orders.list()})),
})

// client
await client.connect(({incoming, outgoing}) => {
    incoming.on({
        onSnapshot: async ({orders}) => store.replaceAll(orders),
        onOrder: async ({order}) => store.upsert(order),
    })
    outgoing.requestSnapshot()
})
```

* Broadcasts made while `seed` runs are queued and delivered right after it — never lost, but they
  may already be in the snapshot, so make deltas safe to apply twice (upsert, not increment).
* Joining again re-seeds the connection; only the newest seed's sends go out.
* If `seed` throws, an existing member stays subscribed and a new connection is left out.

## Scope

**One process.** For several server instances, publish changes through `@grest-ts/events` and call
`out` from each instance's subscriber. Each instance needs its own subscription — instances sharing
one queue split the messages, so each update would reach only some clients.

**One audience.** For per-tenant or per-user audiences, keep one `GGSocketBroadcast` per key.
