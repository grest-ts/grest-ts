import {GG_CONTEXT_STORAGE, GGContext, GGContextKey} from "@grest-ts/context"
import {IsGGAuthTokensResult as IsTokenPair, IsGGAccessTokenData as IsAccessToken} from "@grest-ts/auth"
import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {OrgApi, OrgScopedApi} from "../../api/OrgApi"
import {BannerApi} from "../../api/BannerApi"
import {LiveApi} from "../../api/LiveApi"
import {USER_TOKEN_WIRE} from "../../api/auth/UserAuth"
import {ORG_TOKEN_WIRE} from "../../api/auth/OrgAuth"
// Initialize a persistent global browser context so GGContextKey works outside Node.js AsyncLocalStorage.
GG_CONTEXT_STORAGE.enterWith(new GGContext("browser"))

const URL = ""; // Same-origin clients — Vite proxy forwards /pub, /api, /ws to the auth server (port 4600).
const WS_URL = window.location.origin.replace(/^http/, "ws");
export const api = {
    authApi: AuthPublicApi.createClient({url: URL}),
    userApi: UserApi.createClient({url: URL}),
    orgApi: OrgApi.createClient({url: URL}),
    orgScopedApi: OrgScopedApi.createClient({url: URL}),
    bannerApi: BannerApi.createClient({url: URL}),
    createLiveClient: () => LiveApi.createClient({url: WS_URL})
}

// Async-context stores (Security §3: a context store, NEVER a captured per-user object).
// On the browser this is the single global context set up in api.ts.
export const USER_SESSION = new GGContextKey("userSession", IsTokenPair)
export const ORG_SESSION = new GGContextKey("orgSession", IsAccessToken)

// Outbound half of USER_TOKEN_WIRE: what value to attach, when it's stale, how to recover.
// recover()'s dedup is handled by the synchronizer (now in @grest-ts/http) so concurrent
// calls share one refresh.
USER_TOKEN_WIRE.defineClient(() => ({
    value: () => USER_SESSION.get()?.access?.token,
    isStale: () => !!USER_SESSION.get()?.access?.token && JSON.parse(atob(USER_SESSION.get()!.access.token.split(".")[1])).exp * 1000 <= Date.now(),
    recover: async () => USER_SESSION.set(await api.authApi.refresh({refreshToken: USER_SESSION.get()!.refresh.token})),
})).create()

// Org token is access-only and short-lived — no refresh path; re-select an org to mint a new one.
ORG_TOKEN_WIRE.defineClient(() => ({
    value: () => ORG_SESSION.get()?.token
})).create()

