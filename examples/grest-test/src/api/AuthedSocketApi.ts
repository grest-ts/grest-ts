import {defineSocketContract, webSocketSchema, GGWebSocketMiddleware, GGWebSocketHandshakeContext} from "@grest-ts/websocket"
import {
    GGContractClient,
    GGContractImplementation,
    IsObject,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGContextKey} from "@grest-ts/context"

// ---------------------------------------------------------
// Context keys
// ---------------------------------------------------------

/** Client-side: the bearer token to send on the handshake. Set before connect. */
export const CLIENT_AUTH_TOKEN = new GGContextKey<string>("clientAuthToken", IsString)

const IsAuthedUser = IsObject({
    username: IsString,
})
export type AuthedUser = typeof IsAuthedUser.infer

/** Server-side: the authenticated user, populated by middleware after handshake. */
export const SERVER_AUTHED_USER = new GGContextKey<AuthedUser>("serverAuthedUser", IsAuthedUser)

// ---------------------------------------------------------
// Middleware — symmetric: client sets header, server validates
// ---------------------------------------------------------

const VALID_TOKENS: Record<string, AuthedUser> = {
    "secret-alice": {username: "alice"},
    "secret-bob":   {username: "bob"},
}

export const AuthedSocketMiddleware: GGWebSocketMiddleware = {
    // Client-side: fires during createClient's connect() when building handshake.
    updateHandshake(ctx: GGWebSocketHandshakeContext): void {
        const token = CLIENT_AUTH_TOKEN.get()
        if (token) {
            ctx.headers["authorization"] = "Bearer " + token
        }
    },

    // Server-side: fires when handshake message arrives.
    parseHandshake(ctx: GGWebSocketHandshakeContext): void {
        const header = ctx.headers["authorization"]
        if (!header?.startsWith("Bearer ")) {
            throw new NOT_AUTHORIZED({displayMessage: "Missing bearer token"})
        }
        const token = header.substring(7)
        const user = VALID_TOKENS[token]
        if (!user) {
            throw new NOT_AUTHORIZED({displayMessage: "Invalid token"})
        }
        SERVER_AUTHED_USER.set(user)
    },
}

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const AuthedSocketApiContract = defineSocketContract("AuthedSocketApi", {
    clientToServer: {
        whoAmI: {
            success: IsAuthedUser,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
    },
    serverToClient: {},
})

export const AuthedSocketApi = webSocketSchema(AuthedSocketApiContract)
    .path("ws/authed-test")
    .use(AuthedSocketMiddleware)
    .done()

export type AuthedSocketIncoming = GGContractImplementation<typeof AuthedSocketApiContract.methods["clientToServer"]>
export type AuthedSocketOutgoing = GGContractClient<typeof AuthedSocketApiContract.methods["serverToClient"]>
