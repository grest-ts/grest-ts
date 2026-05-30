import {NOT_AUTHORIZED} from "@grest-ts/schema"
import type {GGContextKey} from "@grest-ts/context"
import type {GGHttpServerMiddleware} from "@grest-ts/http"
import type {GGWebSocketMiddleware} from "@grest-ts/websocket"
import {AuthError} from "../errors"
import type {AuthToken, AccessPayload} from "../token/AuthToken"

// Verifies the raw token a wire binding (header()) parsed into the key and publishes the
// payload. Backs both wires: as a GGHttpServerMiddleware (HTTP) and a GGWebSocketMiddleware
// (WS handshake); the binding's parseRequest/parseHandshake already placed the raw token in
// the key. Fail-closed by default (missing → NOT_AUTHORIZED); present-but-invalid is always
// NOT_AUTHORIZED. required:false lets a missing secondary token through.
export class AuthMiddleware<P extends string, C extends object> implements GGHttpServerMiddleware, GGWebSocketMiddleware {

    constructor(
        private readonly engine: AuthToken<P, C>,
        private readonly tokenKey: GGContextKey<string | undefined>,
        private readonly context: GGContextKey<AccessPayload<P, C>>,
        private readonly required: boolean,
    ) {}

    public process = async (): Promise<void> => {
        const raw = this.tokenKey.get()
        if (!raw) {
            if (this.required) throw new NOT_AUTHORIZED({debugMessage: `Missing ${this.tokenKey.name}`})
            return
        }
        try {
            this.context.set(await this.engine.verifyAccess(raw))
        } catch (err) {
            if (err instanceof AuthError) throw new NOT_AUTHORIZED({debugMessage: err.code})
            throw err
        }
    }
}
