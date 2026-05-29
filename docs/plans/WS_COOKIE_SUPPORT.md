# Plan: first-class WebSocket cookie support

## Goal

Let the **same cookie context key** used over HTTP (`new GGContextKey<string|undefined>(...)`
bound via `httpSchema(...).useCookie(key, opts)`) be **populated from the browser's
`Cookie` on the WebSocket upgrade**, so an auth guard reading `SESSION.get()` works
identically on HTTP requests and WS connections. WS is **read-only** for cookies — a
socket never emits `Set-Cookie` (cookies are minted on the HTTP login/refresh and ride
along on the upgrade).

This replaces the interim "ticket pattern" (HTTP endpoint mints a short-lived ticket,
browser passes it on the handshake via `TokenTransport`) documented in
`packages/http/http/README.md`. The ticket pattern keeps working; this makes the cookie
path first-class.

## The core constraint (why it isn't already done)

grest-ts WS authentication runs off an **in-band `HANDSHAKE` message** (the client app
explicitly sends headers in `msg.data`), not the HTTP upgrade request headers. See
`packages/http/http/websocket/src/server/GGSocketServer.ts`:
- the `'upgrade'` handler (~line 53) has `req` (carrying the browser's auto-attached
  `Cookie`) but only uses it for path/query and then **discards it**;
- the handshake context is built from the in-band message (~line 264:
  `const headers = msg.data || {}`).

A browser **cannot** put an httpOnly cookie into the in-band message (JS can't read it),
so the cookie must come from the real upgrade request. That means exposing the upgrade
request headers in the handshake context.

## Approach

1. **Capture upgrade headers.** In `GGSocketServer` where the `'upgrade'`/`connection`
   handler runs (`~:53-59`), stash `req.headers` on the connection so it survives to
   handshake time.
2. **Expose them on the handshake context.** Extend `GGWebSocketHandshakeContext`
   (`packages/http/http/websocket/src/schema/GGWebSocketMiddleware.ts`) with the real
   upgrade request headers — either a new `requestHeaders` field, or seed `headers` from
   the upgrade request and let the in-band message overlay it. **For security-sensitive
   transport headers like `cookie`, the real upgrade header must win** over anything the
   client put in-band (the client controls the in-band message and could spoof; it cannot
   forge the browser's `Cookie`). Build the context from upgrade headers at
   `GGSocketServer.ts:~264`.
3. **WS side of the cookie binding.** Have `createCookieMiddleware`
   (`packages/http/http/src/schema/cookieMiddleware.ts`) **also** implement
   `GGWebSocketMiddleware.parseHandshake(ctx)`: read `ctx`'s cookie header, parse the
   named cookie (reuse the same parse logic, including the malformed-percent-encoding
   try/catch), and `key.set(value)`. **No `updateResponse`/emit on WS** — read-only.
   Then `.useCookie(...)` registers the binding on both the HTTP and WS schemas.
   - Note: today `createCookieMiddleware` returns a `GGHttpTransportMiddleware`. It will
     need to also satisfy `GGWebSocketMiddleware` (like `TokenTransport` does, which
     implements both). Confirm `.useCookie` (or a WS equivalent) attaches it to the WS
     schema's middleware list.
4. **Connect-time gate.** A WS connect-permission resolver / guard reads `SESSION.get()`
   exactly like an HTTP guard. No new gate machinery — the existing
   `connectPermission` / `permissionResolver` path
   (`GGWebSocketSchema.startServer.ts`) consumes the populated context.

## Files

- `packages/http/http/websocket/src/server/GGSocketServer.ts` — capture + thread upgrade headers.
- `packages/http/http/websocket/src/schema/GGWebSocketMiddleware.ts` — `GGWebSocketHandshakeContext` shape; precedence rule.
- `packages/http/http/src/schema/cookieMiddleware.ts` — add `parseHandshake`; share parse logic.
- `packages/http/http/src/schema/httpSchema.ts` / the WS schema builder — ensure `.useCookie` (or a WS attach path) wires the binding onto WS schemas.

## Risks / decisions

- **Precedence (decide explicitly):** real upgrade headers win over in-band for
  transport headers (recommended for `cookie`), vs. in-band wins / separate namespace.
  This is the one behavior-changing call — it adds a second header source to a currently
  single-source (in-band) handshake. Keep the change additive and confined.
- **Proxies.** In deployments that re-encrypt/proxy the WS upgrade (e.g. a hosting
  proxy), confirm the `Cookie` header survives the upgrade hop; if not, the ticket
  pattern remains the fallback.
- **No Set-Cookie on WS** — keep the WS side strictly read-only.

## Tests

- Real-wire WS test (mirror `examples/grest-test/test/cookie-integration.test.ts`): open a
  socket with a `Cookie` header on the upgrade, assert a guard/handler reads `SESSION.get()`.
- Connect-gate test: a socket without the cookie is rejected; with a valid cookie, accepted.
- Confirm in-band spoofing of `cookie` cannot override the real upgrade `Cookie`.
