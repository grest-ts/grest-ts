import {GGHttpRequest} from "@grest-ts/http"
import {GGWebSocketHandshakeContext} from "@grest-ts/websocket"
import {GGContextKey} from "@grest-ts/context"
import {GGSchema, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"

export const IsUserAuthToken = IsString.brand("UserAuthToken")
export type tUserAuthToken = typeof IsUserAuthToken.infer

export const IsUserId = IsString.brand("UserId")
export type tUserId = typeof IsUserId.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString,
})
export type User = typeof IsUser.infer

export class UserAuth extends GGContextKey<tUserAuthToken> {
    readonly headers: Record<string, GGSchema<string | undefined>> = {
        "authorization": IsString.orUndefined.docs({
            title: "Bearer token",
            format: "bearer",
            description: "HTTP Authorization header with Bearer token",
            example: "Bearer token-user-1-1234567890",
        }),
    }
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    updateRequest(req: GGHttpRequest): void {
        const token = GG_USER_AUTH_TOKEN.get()
        if (token && req.headers) req.headers["authorization"] = `Bearer ${token}`
    }

    parseRequest(req: GGHttpRequest): void {
        this.parseAuthHeader((req.headers ?? {}) as Record<string, string>)
    }

    updateHandshake(context: GGWebSocketHandshakeContext): void {
        const token = GG_USER_AUTH_TOKEN.get()
        if (token) context.headers["authorization"] = `Bearer ${token}`
    }

    parseHandshake(context: GGWebSocketHandshakeContext): void {
        this.parseAuthHeader(context.headers)
    }

    private parseAuthHeader(headers: Record<string, string>): void {
        const authHeader = headers["authorization"]
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new NOT_AUTHORIZED({displayMessage: "Missing or invalid authorization header"})
        }
        GG_USER_AUTH_TOKEN.set(authHeader.substring(7) as tUserAuthToken)
    }
}

export const GG_USER_AUTH_TOKEN = new UserAuth("user", IsUserAuthToken)
