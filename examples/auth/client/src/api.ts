import {GG_CONTEXT_STORAGE, GGContext} from "@grest-ts/context"
import {GGAuthSession, DerivedConfig} from "@grest-ts/auth"
import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {OrgApi, OrgScopedApi, SelectOrgRequest} from "../../api/OrgApi"
import {BannerApi} from "../../api/BannerApi"
import {LiveApi} from "../../api/LiveApi"
import {USER_TOKEN_WIRE, User, UserPermission} from "../../api/auth/UserAuth"
import {ORG_TOKEN_WIRE, Org} from "../../api/auth/OrgAuth"
// Initialize a persistent global browser context so GGContextKey works outside Node.js AsyncLocalStorage.
GG_CONTEXT_STORAGE.enterWith(new GGContext("browser"))

const URL = {url: ""}; // Same-origin clients — Vite proxy forwards /pub, /api, /ws to the auth server (port 4600).
const WS_URL = {url: window.location.origin.replace(/^http/, "ws")};
export const api = {
    authApi: AuthPublicApi.createClient(URL),
    userApi: UserApi.createClient(URL),
    orgApi: OrgApi.createClient(URL),
    orgScopedApi: OrgScopedApi.createClient(URL),
    bannerApi: BannerApi.createClient(URL),
    createLiveClient: () => LiveApi.createClient(WS_URL)
}

// The session OWNS the client token lifecycle (localStorage persistence, cross-tab refresh
// dedup, proactive scheduled refresh, status, derived org token) AND configures the wires
// itself: it already holds USER_TOKEN_WIRE (withToken) and ORG_TOKEN_WIRE (addDerived), so it
// calls their .defineClient internally — the successor to the GGContextKeySynchronizer.provide()
// it used to do. No app-level defineClient needed.
// App-owned session: subclass GGAuthSession to add UX permission helpers over the identity
// `data` the server returns (User.permissions). The server re-checks every call — these only
// drive the UI, and the session never decodes the opaque access token.
class AppSession extends GGAuthSession<{org: DerivedConfig<SelectOrgRequest, Org>}> {
    public get permissions(): UserPermission[] {
        return (this.get() as User | undefined)?.permissions ?? []
    }

    public hasPermission(permission: UserPermission): boolean {
        return this.permissions.includes(permission)
    }
}

export const session = AppSession
    .withToken(USER_TOKEN_WIRE, {refresh: api.authApi.refresh, localStorageKey: "auth"})
    .addDerived("org", ORG_TOKEN_WIRE, {mint: api.orgApi.selectOrg}) as AppSession

// ── Core session API (documentation only — gated off; real usage lives in App.tsx) ──────────
if (false as boolean) {
    session.login({username: "alice", password: "secret123"})            // authenticate + store tokens
    session.isLoggedIn()                                                 // boolean: active session?
    session.hasPermission(UserPermission.CAN_UPDATE_RED_BANNER_COUNTER)  // UX gate only — server re-checks
    session.get().email                                                 // current user identity
    session.logout()                                                    // clear session + tokens
}