# WebSocket Broadcast

How to push the same server→client message to every connected client with `GGSocketBroadcast`.

## Basic Broadcast

`GGSocketBroadcast` holds the set of joined connections for one socket schema. Its `out` has one
method per `serverToClient` method of the contract; calling it sends to every member.

```typescript
import {GGSocketBroadcast} from "@grest-ts/websocket"
import {OrderEventsSocket} from "./OrderEventsSocket"

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

* A connection stays a member until it closes; there is no `leave`.
* `out` methods are fire-and-forget: a send that fails for one connection is logged and the
  others still receive it. They return nothing to `await`.
* `out` has no `onClose`/`close` — it is the audience, not a connection.

## Snapshot + Delta

A common live-state pattern: on connect the client gets the full state (snapshot), then only
changes (deltas). Pass a `seed` to `join` to send the snapshot to that connection first:

```typescript
export const OrderEventsContract = new GGDuplexContract("OrderEvents", {
    connect: {},
    clientToServer: {
        requestSnapshot: {permission: GG_NO_PERMISSIONS},
    },
    serverToClient: {
        onSnapshot: {input: IsObject({orders: IsArray(IsOrder)}), permission: GG_NO_PERMISSIONS},
        onOrder: {input: IsObject({order: IsOrder}), permission: GG_NO_PERMISSIONS},
    },
})
```

```typescript
handleConnection = (incoming: typeof OrderEventsSocket.clientToServer, outgoing: typeof OrderEventsSocket.serverToClient): void => {
    incoming.on({
        requestSnapshot: () => this.broadcast.join(outgoing, async o => o.onSnapshot({orders: await this.orders.list()})),
    })
}
```

* Whatever `seed` sends is the first frame the connection gets from the broadcast.
* Broadcasts made while `seed` is still running are queued and delivered right after it, so none
  are lost. They may already be reflected in the snapshot, so make deltas safe to apply twice
  (upsert / replace, not increment).
* Joining again with a `seed` re-seeds the connection (a client that re-subscribes over a shared,
  pooled socket gets a fresh snapshot); the newest seed wins.
* If `seed` throws, the connection is left out and the error reaches the calling handler.

Let the client ask for the snapshot (`requestSnapshot` above) instead of seeding in
`handleConnection`. The client sends it after registering its `incoming` handlers — on every
reconnect — so the snapshot can't arrive before anything listens for it:

```typescript
const client = OrderEventsSocket.createClient()
await client.connect(({incoming, outgoing}) => {
    incoming.on({
        onSnapshot: async ({orders}) => store.replaceAll(orders),
        onOrder: async ({order}) => store.upsert(order),
    })
    outgoing.requestSnapshot()
})
```

## Audiences

One `GGSocketBroadcast` is one audience: every member gets every message. For per-tenant or
per-user audiences, keep one instance per key, or track connections yourself as in the
[connection handler example](@pkg/websocket#connection-handler).
