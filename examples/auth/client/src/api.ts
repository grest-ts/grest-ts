import {GGContext, GG_CONTEXT_STORAGE} from "@grest-ts/context"
import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {LiveApi} from "../../api/LiveApi"
import {GG_USER_AUTH_TOKEN, tUserAuthToken} from "../../api/auth/UserAuth"

// Initialize a persistent global browser context so GGContextKey works outside Node.js AsyncLocalStorage.
// This is safe for single-user browser apps — the context is one global shared store.
const browserContext = new GGContext("browser")
GG_CONTEXT_STORAGE.enterWith(browserContext)

const WS_URL = window.location.origin.replace(/^http/, "ws")

// Same-origin clients — Vite proxy forwards /pub, /api, /ws to the auth server (port 4600).
export const authApi = AuthPublicApi.createClient({url: ""})
export const userApi = UserApi.createClient({url: ""})

// Create a fresh WebSocket client each time — a disconnected client can't reconnect.
export function createLiveClient() {
    return LiveApi.createClient({url: WS_URL})
}

export function setAuthToken(token: tUserAuthToken): void {
    GG_USER_AUTH_TOKEN.set(token)
}

export function clearAuthToken(): void {
    GG_USER_AUTH_TOKEN.delete()
}
