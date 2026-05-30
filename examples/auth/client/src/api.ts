import {GG_CONTEXT_STORAGE, GGContext} from "@grest-ts/context"
import {GGAuthSession} from "@grest-ts/auth"
import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {OrgApi} from "../../api/OrgApi"
import {BannerApi} from "../../api/BannerApi"
import {LiveApi} from "../../api/LiveApi"
import {USER_TOKEN} from "../../api/auth/UserAuth"
import {ORG_TOKEN} from "../../api/auth/OrgAuth"
import type {SelectOrgRequest} from "../../api/OrgApi"

// Initialize a persistent global browser context so GGContextKey works outside Node.js AsyncLocalStorage.
const browserContext = new GGContext("browser")
GG_CONTEXT_STORAGE.enterWith(browserContext)

const URL = ""; // Same-origin clients — Vite proxy forwards /pub, /api, /ws to the auth server (port 4600).
const WS_URL = window.location.origin.replace(/^http/, "ws");
export const api = {
    authApi: AuthPublicApi.createClient({url: URL}),
    userApi: UserApi.createClient({url: URL}),
    orgApi: OrgApi.createClient({url: URL}),
    bannerApi: BannerApi.createClient({url: URL}),
    createLiveClient: () => {
        return LiveApi.createClient({url: WS_URL})
    }
}

export const session = GGAuthSession.withToken(USER_TOKEN, (token) => api.authApi.refresh({refreshToken: token}))
    .addDerived("org", ORG_TOKEN, async (data: SelectOrgRequest) => {
        const res = await api.orgApi.selectOrg(data)
        return {accessToken: res.orgToken, accessExpiresAt: res.orgTokenExpiresAt, ...res.org}
    })

