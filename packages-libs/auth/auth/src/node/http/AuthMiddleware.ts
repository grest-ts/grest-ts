import {NOT_AUTHORIZED} from "@grest-ts/schema"
import type {GGContextKey, GGTransportMiddleware} from "@grest-ts/context"
import {AuthError} from "../errors"
import type {AuthToken, AccessPayload} from "../token/AuthToken"

// Verifies the raw token a wire binding (GGHeader.middleware) parsed into the key and
// publishes the payload. Backs both HTTP and WS handshake wires; the binding's parse
// already placed the raw token in the key. Fail-closed by default (missing →
// NOT_AUTHORIZED); present-but-invalid is always NOT_AUTHORIZED. required:false lets a
// missing secondary token through.
export class AuthMiddleware<P extends string, C extends object> implements GGTransportMiddleware {

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
