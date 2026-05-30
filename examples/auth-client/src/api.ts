import {GGContext, GG_CONTEXT_STORAGE} from "@grest-ts/context"
import {AuthPublicApi} from "../../auth/common/api/AuthPublicApi"
import {UserApi} from "../../auth/common/api/UserApi"
import {LiveApi} from "../../auth/common/api/LiveApi"
import {GG_USER_AUTH_TOKEN, tUserAuthToken} from "../../auth/common/api/auth/UserAuth"

// Initialize a persistent global browser context so GGContextKey works outside Node.js AsyncLocalStorage.
// This is safe for single-user browser apps — the context is one global shared store.
const browserContext = new GGContext("browser")
GG_CONTEXT_STORAGE.enterWith(browserContext)

// Same-origin clients — Vite proxy forwards these paths to the auth server (port 4000 by default).
export const authApi = AuthPublicApi.createClient({url: ""})
export const userApi = UserApi.createClient({url: ""})
export const liveApi = LiveApi.createClient({
    url: `${window.location.origin.replace(/^http/, "ws")}`,
})

export function setAuthToken(token: tUserAuthToken): void {
    GG_USER_AUTH_TOKEN.set(token)
}

export function clearAuthToken(): void {
    GG_USER_AUTH_TOKEN.delete()
}
