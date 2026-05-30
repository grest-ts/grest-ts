import {GGContextKey} from "@grest-ts/context"
import {IsAny, type GGSchema} from "@grest-ts/schema"
import type {AuthToken, AccessPayload, NoClaims} from "../token/AuthToken"
import {AuthMiddleware} from "./AuthMiddleware"

export interface AuthGuardOptions {
    // Fail-closed when the token is absent (default true). False = a secondary
    // token kind layered on a required one (e.g. an org token behind a user token).
    required?: boolean
}

// Server-side binding for one token kind: engine + the context key the wire binding
// parsed the raw token into + the per-request/connection decoded-payload context. Serves
// HTTP and WS equally — one verifying middleware backs both wires. Instantiate once per
// token kind.
export class AuthGuard<P extends string, C extends object = NoClaims> {

    public readonly context: GGContextKey<AccessPayload<P, C>>
    private readonly required: boolean

    constructor(
        public readonly engine: AuthToken<P, C>,
        public readonly tokenKey: GGContextKey<string | undefined>,
        options: AuthGuardOptions = {},
    ) {
        // verifyAccess already validated the payload; the key is just request-scoped storage.
        this.context = new GGContextKey<AccessPayload<P, C>>(`${tokenKey.name}:payload`, IsAny as unknown as GGSchema<AccessPayload<P, C>>)
        this.required = options.required ?? true
    }

    private middleware(): AuthMiddleware<P, C> {
        return new AuthMiddleware(this.engine, this.tokenKey, this.context, this.required)
    }

    public httpMiddleware(): AuthMiddleware<P, C> {
        return this.middleware()
    }

    public wsMiddleware(): AuthMiddleware<P, C> {
        return this.middleware()
    }

    public payload(): AccessPayload<P, C> | undefined {
        return this.context.get()
    }
}
