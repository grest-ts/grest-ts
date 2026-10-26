import {errors as joseErrors} from "jose"
import {NOT_AUTHORIZED} from "@grest-ts/schema"

export function toNotAuthorized(err: unknown): Error {
    if (err instanceof joseErrors.JWTExpired) return new NOT_AUTHORIZED({debugMessage: "TOKEN_EXPIRED"})
    return new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: " + (err as Error).message})
}
