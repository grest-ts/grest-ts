export type AuthErrorCode = "TOKEN_INVALID" | "TOKEN_EXPIRED" | "REFRESH_INVALID" | "REFRESH_REUSE" | "CREDENTIALS_INVALID"

// Framework-agnostic auth failure; the http layer maps it to NOT_AUTHORIZED. Keeping
// the engine free of grest-ts error types lets it be tested without an http server.
export class AuthError extends Error {
    constructor(public readonly code: AuthErrorCode, message?: string) {
        super(message ?? code)
        this.name = "AuthError"
    }
}
