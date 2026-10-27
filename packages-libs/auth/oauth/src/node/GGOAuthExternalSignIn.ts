import {randomBytes} from "node:crypto"
import type {IncomingMessage, ServerResponse} from "node:http"
import {NOT_FOUND} from "@grest-ts/schema"
import {signState, verifyState} from "./signedState"

export interface GGOAuthExternalSignInOptions {
    // Where the upstream sends the browser back (a path on the host it is registered on); the state cookie is scoped to it.
    callbackPath: string
    // Where a callback that can't continue goes: a tampered or expired state cookie, an expired sign-in.
    fallbackUrl: () => string
}

// What the app made of the upstream's answer: who signed in, or its own error code for the sign-in page.
export type GGOAuthExternalResult = {accountId: string, amr?: string[]} | {error: string}

export interface GGOAuthRedirect {
    location: string
    setCookie?: string
}

type Pending<D> = {state: string, uid: string, data?: D}
type SignInServer = {
    loginTicketUrl: (uid: string, accountId: string, amr?: string[]) => Promise<string>
    interactionUrl: (uid: string, error?: string) => Promise<string>
}

const TTL_SEC = 600
const MAX_COOKIE_BYTES = 4000
const STATE = /^[A-Za-z0-9_-]{1,64}$/
// One cookie per sign-in in progress (named by its state), so a second tab's start doesn't overwrite the first's.
const cookieName = (state: string): string => `gg_signin_${state}`

// A sign-in that completes on an upstream (an OIDC IdP, GitHub) whose callback is on a host the app registers.
// The state cookie set at start must come back with a matching `state`, and the login ticket it ends with
// only completes in the browser that started the flow: the round trip stays in one browser.
export class GGOAuthExternalSignIn<D = undefined> {

    private readonly server: SignInServer
    private readonly key: () => Buffer
    private readonly options: GGOAuthExternalSignInOptions

    constructor(server: SignInServer, key: () => Buffer, options: GGOAuthExternalSignInOptions) {
        this.server = server
        this.key = key
        this.options = options
    }

    // `authorize` builds the upstream's authorization URL carrying `state`; `data` (e.g. PKCE checks) comes
    // back to the callback inside the signed cookie, readable by the browser but not changeable.
    public start = async (uid: string, authorize: (state: string) => Promise<{url: string, data?: D}>): Promise<GGOAuthRedirect> => {
        const state = randomBytes(24).toString("base64url")
        const {url, data} = await authorize(state)
        const setCookie = this.cookie(state, signState(this.key(), {state, uid, data} satisfies Pending<D>, TTL_SEC * 1000), TTL_SEC)
        if (setCookie.length > MAX_COOKIE_BYTES) throw new Error("GGOAuthExternalSignIn: the state cookie is too large; keep `data` small")
        return {location: url, setCookie}
    }

    // undefined: no sign-in of this browser has this state (not this flow's callback, e.g. a shared callback
    // URL's other use). `resolve` runs only once the cookie and `state` check out, so a forged `?error=`
    // can't cancel someone's sign-in.
    public callback = async (req: IncomingMessage, resolve: (upstream: {params: URLSearchParams, query: string, data: D}) => Promise<GGOAuthExternalResult>): Promise<GGOAuthRedirect | undefined> => {
        const url = new URL(req.url ?? "/", "http://x")
        const state = url.searchParams.get("state") ?? ""
        if (!STATE.test(state)) return undefined
        const raw = readCookie(req, cookieName(state))
        if (raw === undefined) return undefined
        const setCookie = this.cookie(state, "", 0)
        const pending = verifyState<Pending<D>>(this.key(), raw)
        if (pending?.state !== state) return {location: this.options.fallbackUrl(), setCookie}
        const result = await resolve({params: url.searchParams, query: url.search, data: pending.data as D})
        const location = "accountId" in result
            ? this.server.loginTicketUrl(pending.uid, result.accountId, result.amr)
            : this.server.interactionUrl(pending.uid, result.error)
        // The sign-in expired meanwhile.
        return {location: await location.catch((err: unknown) => {
            if (err instanceof NOT_FOUND) return this.options.fallbackUrl()
            throw err
        }), setCookie}
    }

    public send = (res: ServerResponse, redirect: GGOAuthRedirect): void => {
        res.writeHead(302, {"location": redirect.location, "cache-control": "no-store", ...redirect.setCookie ? {"set-cookie": redirect.setCookie} : {}})
        res.end()
    }

    // SameSite=Lax: the upstream's redirect back is a top-level GET.
    private cookie(state: string, value: string, maxAgeSec: number): string {
        return `${cookieName(state)}=${value}; Path=${this.options.callbackPath}; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`
    }
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const eq = part.indexOf("=")
        if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
    }
    return undefined
}
