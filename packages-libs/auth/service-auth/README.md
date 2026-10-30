<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/service-auth

Authentication between your own services. Two services share a secret; the caller sends it in a
header and the callee checks it before any handler runs. It is a smart wire like the ones in
[`@grest-ts/auth`](../auth/README.md): declared once as a `GGHeader`, listed in a schema's `use`,
given its server half with `GGSharedSecret.verify` and its client half with `GGSharedSecret.attach`.

User sessions, JWTs and identity providers live in `@grest-ts/auth`; this package is only for
machine-to-machine calls inside one deployment.

## 1. Declare the wire and use it on the internal schema

```ts
// api package
import {GGHeader, GGHttpSchema, GGRpc} from "@grest-ts/http"

export const INTERNAL_SECRET_WIRE = new GGHeader("x-internal-secret")

export const NotifyApi = new GGHttpSchema({
    contract: NotifyApiContract,
    pathPrefix: "internal/notify",
    use: [INTERNAL_SECRET_WIRE],      // every route needs the secret
    routes: {publish: GGRpc.POST("publish")},
})
```

## 2. Server — verify

`GGSharedSecret.verify(wire)` attaches the check to the wire. Call it once, at module level, and
bind the configured secret into each runtime with `.create(secret)`:

```ts
import {GGSharedSecret} from "@grest-ts/service-auth"

export const INTERNAL_SECRET_HANDLER = GGSharedSecret.verify(INTERNAL_SECRET_WIRE)

export class SocketRuntime extends GGRuntime {
    public static readonly NAME = "socket"

    protected compose(): void {
        INTERNAL_SECRET_HANDLER.create(SocketConfig.settings.internalSecret)   // a GGSecret<string>
        new GGHttp(new GGHttpServer()).http(NotifyApi, notifyService)
    }
}
```

A call is refused with `NOT_AUTHORIZED` when:
- the header is missing or doesn't match,
- the configured secret is empty (fail-closed: an unset secret never means "open").

The comparison runs on HMAC-SHA256 digests of both values, so its timing doesn't depend on how much
of the presented value matches, or on whether its length matches the secret's. The secret is read on each request, so `.create()` may run
before the config store is live, and a changed secret applies to the next request.

## 3. Client — attach

`GGSharedSecret.attach(wire, secret)` returns a client wire that sends the configured secret
with every request:

```ts
const notify = NotifyApi.createClient({
    wires: [GGSharedSecret.attach(INTERNAL_SECRET_WIRE, HubConfig.settings.internalSecret)],
})
await notify.publish(event)
```

An empty client secret is sent as is, and the server refuses it.

## 4. Config

Both sides read the same value from their own config, typically a `GGSecret` in each service's
`GGConfig`:

```ts
internalSecret: new GGSecret("internal_secret", IsString, "Shared with the socket service's internal_secret"),
```

## 5. Testing

Boot the runtime with `@grest-ts/testkit` and present the header through a context:

```ts
import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"

GGTest.startInline(SocketRuntime)

function presenting(secret: string): GGContext {
    const scope = new GGContext("internal-call")
    scope.set(INTERNAL_SECRET_WIRE, secret)
    return scope
}

test("refuses a wrong secret", async () => {
    await callOn(NotifyApi, presenting("wrong")).publish(event).toBeError(NOT_AUTHORIZED)
})
```

[`examples/grest-test/test/shared-secret.test.ts`](../../../examples/grest-test/test/shared-secret.test.ts)
covers both halves end to end.

## Reference

`GGSharedSecret` (node only):
- `verify(wire)` → the wire's server registration; `.create(secret: GGSecret<string>)` once per runtime.
- `attach(wire, secret)` → a `GGHttpClientWire` for a client's `wires`.
- `equals(a, b)` → constant-time string comparison over HMAC digests.
