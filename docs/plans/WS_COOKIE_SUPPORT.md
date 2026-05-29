# Handoff: first-class WebSocket cookie support (`@grest-ts/http`)

> **STATUS: IMPLEMENTED (2026-05-29).** Shipped as designed below.
> - `readCookie` extracted + exported from `cookieMiddleware.ts` (shared HTTP/WS parse).
> - `GGWebSocketHandshakeContext.upgradeHeaders` added; `GGSocketServer` threads the real
>   upgrade `req.headers` into it.
> - `createCookieHandshakeMiddleware(key)` (new `cookieHandshakeMiddleware.ts`) reads the
>   cookie from `upgradeHeaders` only; `webSocketSchema(...).useCookie(key)` attaches it.
> - Fixture `WsCookieApi` (reuses the HTTP `SESSION` key) + `WsCookieService`; raw-`ws`
>   integration tests in `examples/grest-test/test/websocket-cookie-integration.test.ts`
>   plus `readCookie` unit tests in `cookie.test.ts`.
> - Documented in `packages/http/websocket/README.md` → "Cookies".

You're picking up the WebSocket half of httpOnly-cookie support. The HTTP half is
done and merged onto branch `kratt/cookie-support` (commits `feat(http): httpOnly
session cookies` … through `feat(http): add GGContextKeyForCookie.delete()`). Read
`packages/http/http/README.md` ("Cookies") and `packages/http/http/src/schema/cookieMiddleware.ts`
first — that's the established model you must stay consistent with.

---

## 1. Context & design philosophy (how to think about this)

This feature went through many iterations with the owner; the decisions below are
deliberate, not accidental. Follow the same reasoning:

- **The contract is transport-agnostic.** `GGContractClass` / `GGContractMethod`
  describe input/output/errors/permission only. A cookie is an **HTTP/transport**
  concern, so nothing cookie-specific lives on the contract. (WS is also a transport —
  same rule: don't push cookie/WS specifics into the contract.)
- **A cookie is a context key bound to the wire.** `SESSION = new GGContextKeyForCookie("session")`
  — it *is* a `GGContextKey` (read with `.get()`), whose value rides as a cookie. The
  wire name **is** the key name (one naming convention; `.useCookie(SESSION)` takes no
  name). This mirrors how auth context keys work.
- **Read is implicit; write is explicit.** Reading the cookie (`SESSION.get()`) needs
  no per-route declaration — `.useCookie(SESSION)` on the schema wires parsing for every
  route, exactly like an auth middleware. **Writing** is gated: only a route that
  declared `.updatesCookie(SESSION)` may change it; an undeclared write is a
  `SERVER_ERROR` (rolled back + logged). The asymmetry is the point: the server *reads*
  auth/cookies from the request freely, but *producing* a cookie (a `Set-Cookie`
  side-effect) is security-sensitive and must be visible at the API boundary so a deep
  service function can't silently mint/change a session.
- **Write rules live at the `.set()` site, never in the shared API.** `SESSION.set(value, options)`
  carries `httpOnly`/`secure`/`sameSite`/`path`/`domain`/`maxAgeSec` (safe defaults
  applied by the serializer). The schema/API ships only the wire name. **Do not** put
  cookie policy anywhere the browser-facing API definition can see it.
- **Emit-on-change.** The binding emits `Set-Cookie` only when a handler *changes* the
  key vs. what arrived (`set(token)` → set; `delete()`/`set(undefined)` → `Max-Age=0`;
  untouched → nothing). Reads never re-emit.
- **Security-first defaults + a noted architectural risk.** Default cookie is
  **host-only** (no `Domain`). There's an open kratt-side recommendation to host
  VM/user content on a **separate registrable domain** so the session cookie can never
  reach untrusted subdomains. This matters to you: **a browser auto-attaches the cookie
  to the WS upgrade too**, so the same cross-domain exposure applies on WS — don't widen
  it.
- **How to work:** push back on weak ideas, **flag genuine design decisions for the
  owner rather than guessing**, make the smallest change that's correct, and **test
  every step** — unit tests of the binding plus a **real-wire integration test** in
  `examples/grest-test` (the HTTP side uses raw `fetch`; you'll open a real socket).
  The owner iterates; expect to refine. Don't commit/push a protocol change until it's
  green and the precedence decision (below) is settled.

---

## 2. Current cookie API (HTTP) — what you extend

- `GGContextKeyForCookie extends GGContextKey<string | undefined>` (in
  `cookieMiddleware.ts`): `.get()`, `.set(value, options?)`, `.delete(options?)`.
- `createCookieMiddleware(key): GGHttpTransportMiddleware` — `parseRequest` reads the
  `Cookie` header (named by `key.name`) into the key; `updateResponse` emits/clears with
  dirty-tracking + the write-gate.
- `httpSchema(...).useCookie(SESSION)` attaches the binding; `GGRpc.*(...).updatesCookie(SESSION)`
  declares write permission; `GG_COOKIE_WRITES` is the per-request declared-writes set.

---

## 3. Goal (WS)

The **same `SESSION` key**, populated **read-only** from the browser's `Cookie` on the
WS upgrade, so a connect guard / handler reads `SESSION.get()` identically on HTTP and
WS. **No `Set-Cookie` on a WebSocket** — cookies are minted on HTTP login/refresh and
ride along on the upgrade. So on WS: parse/read only; the `.set()`/`.delete()`/emit/
`.updatesCookie` machinery stays HTTP-only.

**Scope: browser-only.** Cookie auth targets browsers (the cookie rides the upgrade
automatically). Node service-to-service clients keep using bearer tokens / discovery —
`GGSocketPool.openSocket` does not forward headers to `NodeSocketAdapter` today and we
are **not** wiring Node-client cookie sending now.

## 3a. DX — what the app developer writes

The win is **zero client-side auth code**: if the user logged in over HTTP (httpOnly
`SESSION` cookie set), opening a socket just works because the browser auto-attaches the
cookie to the WS upgrade GET.

```ts
// shared api/ — one new line, mirroring httpSchema(...).useCookie(SESSION)
export const SESSION = new GGContextKeyForCookie("session")   // the SAME key as HTTP

export const ChatApi = webSocketSchema(ChatContract)
    .path("ws/chat")
    .useCookie(SESSION)           // NEW on the WS builder — read-only
    .connectPermission(CHAT_USE)  // optional handshake gate
    .done()
```

```ts
// server compose — reuse the existing gate; resolver reads the cookie-derived session
ChatApi.register(chat.handleConnection, {
    http: httpServer,
    permissionResolver: () => scopesFromSession(SESSION.get()),
})
// inside handleConnection: const user = userFromSession(SESSION.get())
```

```ts
// browser client — nothing auth-related to do
const client = ChatApi.createClient({ url: "" })   // same-origin
await client.connect()                              // browser attaches the cookie on upgrade
```

`SESSION.get()` reads identically on HTTP and WS. Writing stays HTTP-only by
construction: there is no `Set-Cookie` on a socket, and WS methods are not HTTP routes,
so `.updatesCookie()` (a `GGRpc.*` route concept) does not exist on WS — `.useCookie()`
on a WS schema is unambiguously read-only.

**`.useCookie()` does not exist on the WS builder yet** — `GGWebSocketSchemaBuilder`
(`packages/http/websocket/src/schema/webSocketSchema.ts`) has `.path/.use/.queryOnConnect/
.connectPermission/.done`. Add `.useCookie(key)` as sugar that pushes the cookie binding
into `_middlewares`, exactly like `httpSchema(...).useCookie`.

## 3b. Accepted limitation (settled with owner, 2026-05-29)

Sockets are long-lived and identity is **pinned at connect**: `SESSION` is read once at
handshake, scopes resolved once and cached for the connection's life (the README's
documented revocation limitation). No mid-stream cookie re-read, no refresh-over-WS, no
`updateResponse`. Clearing the cookie via HTTP logout fails *new* connects but leaves
live sockets alone — close them server-side if hard logout is required. This is accepted
and removes a whole class of work.

## 4. The core constraint (why it isn't already done)

grest-ts WS auth runs off an **in-band `HANDSHAKE` message** (`msg.data`), not the HTTP
upgrade headers. In `packages/http/websocket/src/server/GGSocketServer.ts`: the
`'upgrade'` handler (~line 53) has `req` (with the browser's auto-attached `Cookie`) but
only uses it for path/query and **discards it**; the handshake context is built from the
in-band message (~line 264, `const headers = msg.data || {}`). A browser **cannot** put
an httpOnly cookie into the in-band message (JS can't read it), so the cookie must come
from the real upgrade request — which means exposing the upgrade headers in the
handshake context.

## 5. Approach

1. **Capture upgrade headers.** Where the `'upgrade'`/`connection` handler runs
   (`GGSocketServer.ts` ~53-59), stash `req.headers` so they survive to handshake time.
2. **Expose them on the handshake context — as a separate field (DECIDED).** Extend
   `GGWebSocketHandshakeContext`
   (`packages/http/websocket/src/schema/GGWebSocketMiddleware.ts`) with a new
   server-only `upgradeHeaders: Record<string,string>` (the real, lowercased
   `req.headers`). The existing in-band `headers` map is untouched (still the bearer
   transport). The cookie binding reads **only** `ctx.upgradeHeaders["cookie"]`, so
   in-band can never spoof the browser cookie — no per-header precedence rule needed.
   (Rejected the seed-and-overlay alternative: it maximizes HTTP/WS symmetry for
   hand-written middleware but that symmetry is moot since the cookie binding is
   framework code; the separate field is unambiguous.)
3. **WS side of the cookie binding.** Make the cookie binding also implement
   `GGWebSocketMiddleware.parseHandshake(ctx)`: read the cookie (named `key.name`) from
   the upgrade headers, reuse the exact parse logic from `createCookieMiddleware`
   (including the malformed-percent-encoding `try/catch`), and `key.set(value)` to
   populate the SAME `GGContextKeyForCookie`. **No `updateResponse` on WS.** (Model on
   kratt's `TokenTransport`, which implements both `GGHttpTransportMiddleware` and
   `GGWebSocketMiddleware`.) Confirm the WS schema builder has a `.useCookie(SESSION)`
   (or equivalent attach path) mirroring the HTTP one.
4. **Connect-time gate.** A WS connect-permission resolver / guard reads `SESSION.get()`
   exactly like an HTTP guard. No new gate machinery — reuse the existing
   `connectPermission` / `permissionResolver` path in
   `packages/http/websocket/src/server/GGWebSocketSchema.startServer.ts`.

## 6. Files

- `packages/http/websocket/src/server/GGSocketServer.ts` — capture + thread upgrade headers.
- `packages/http/websocket/src/schema/GGWebSocketMiddleware.ts` — handshake-context shape + precedence.
- `packages/http/http/src/schema/cookieMiddleware.ts` — add `parseHandshake`; share parse logic; keep emit/write-gate HTTP-only.
- WS schema builder — a `.useCookie(SESSION)` attach path mirroring `httpSchema`.

## 7. Decisions (settled with owner, 2026-05-29)

- **Upgrade-header exposure: separate `upgradeHeaders` field** on the handshake context
  (not seed-and-overlay of `headers`). The cookie binding reads only `upgradeHeaders`, so
  the spoofing question is structurally closed — in-band has no `cookie` channel at all.
- **Browser-only scope.** No Node-client cookie sending (see §3).
- **Identity pinned at connect.** No refresh / re-read over WS (see §3b).

## 8. Tests

- Real-wire WS test in `examples/grest-test` (mirror `test/cookie-integration.test.ts`):
  open a socket with a `Cookie` on the upgrade; assert a guard/handler reads
  `SESSION.get()`. Reuse the `CookieTestApi` `SESSION` key.
- Connect-gate: socket without the cookie rejected; with a valid cookie accepted.
- A `cookie` placed in the in-band handshake message is ignored — only the real upgrade
  `Cookie` (via `upgradeHeaders`) populates `SESSION`.
- No `Set-Cookie` is ever emitted on a WS upgrade.
- Run the full sweep via the `run_tests` MCP at the end; keep it green.

## 9. Interim (already shipped)

Until this lands, WS-by-session uses the **ticket pattern**: a cookie-authenticated HTTP
endpoint mints a short-lived ticket; the browser opens the socket with that ticket via
the existing `TokenTransport`. Documented in the README. Your work makes the cookie path
first-class; don't remove the ticket option.
