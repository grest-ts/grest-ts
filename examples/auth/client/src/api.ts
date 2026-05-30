import {GGContext, GG_CONTEXT_STORAGE} from "@grest-ts/context"
import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {OrgApi} from "../../api/OrgApi"
import {BannerApi} from "../../api/BannerApi"
import {LiveApi} from "../../api/LiveApi"
import {USER_TOKEN} from "../../api/auth/UserAuth"
import {ORG_TOKEN} from "../../api/auth/OrgAuth"

// Initialize a persistent global browser context so GGContextKey works outside Node.js AsyncLocalStorage.
const browserContext = new GGContext("browser")
GG_CONTEXT_STORAGE.enterWith(browserContext)

const WS_URL = window.location.origin.replace(/^http/, "ws")

// Same-origin clients — Vite proxy forwards /pub, /api, /ws to the auth server (port 4600).
export const authApi = AuthPublicApi.createClient({url: ""})
export const userApi = UserApi.createClient({url: ""})
export const orgApi  = OrgApi.createClient({url: ""})
export const bannerApi = BannerApi.createClient({url: ""})

export function createLiveClient() {
    return LiveApi.createClient({url: WS_URL})
}

export function setAuthToken(token: string): void {
    USER_TOKEN.set(token)
}
export function clearAuthToken(): void {
    USER_TOKEN.delete()
}

export function setOrgToken(token: string): void {
    ORG_TOKEN.set(token)
}
export function clearOrgToken(): void {
    ORG_TOKEN.delete()
}
