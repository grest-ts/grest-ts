import {ANY_ERROR} from "./ERROR";
import {OK} from "./OK";

/**
 * A promise wrapper for API responses that throws on error by default.
 *
 * **Default behavior (await directly):** Returns success data or throws error
 * ```typescript
 * const user = await api.login({ username, password })
 * // user is LoginResponse - errors throw automatically
 * ```
 *
 * **Explicit handling (.asResult()):** Returns discriminated union for manual handling
 * ```typescript
 * const result = await api.login({ username, password }).asResult()
 * if (result.success) {
 *     console.log(result.data.user)
 * } else {
 *     console.log(result.type) // "NOT_AUTHORIZED", "VALIDATION_ERROR", etc.
 * }
 * ```
 *
 * @template TSuccess - The success data type
 * @template TError - Union of error class types
 */
export class GGPromise<TSuccess, TError extends ANY_ERROR = never> implements Promise<TSuccess> {

    readonly [Symbol.toStringTag] = 'GGPromise'

    constructor(private readonly promise: Promise<OK<TSuccess> | TError>) {
    }

    /**
     * Makes GGResultPromise awaitable. Returns TSuccess directly or throws TError.
     * This is the default, safe behavior - errors are never silently ignored.
     *
     * @example
     * const user = await api.login({ username, password })
     * console.log(user.name) // user is LoginResponse, not OK<LoginResponse>
     *
     * @throws {TError} On error response
     */
    then<TResult1 = TSuccess, TResult2 = never>(
        onfulfilled?: ((value: TSuccess) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this.promise.then(
            (result) => {
                if (result.success) {
                    return onfulfilled ? onfulfilled(result.data) : result.data as any
                } else {
                    // If onrejected handler is provided, call it instead of throwing
                    if (onrejected) {
                        return onrejected(result)
                    }
                    throw result
                }
            },
            onrejected
        )
    }

    /**
     * Registers a callback to run when the promise settles (fulfills or rejects),
     * regardless of outcome.
     *
     * @example
     * await api.login(data).finally(() => setLoading(false))
     */
    finally(onfinally?: (() => void) | null): Promise<TSuccess> {
        return this.then(
            (value) => { onfinally?.(); return value },
            (reason) => { onfinally?.(); throw reason }
        )
    }

    /**
     * Returns the full response as a discriminated union for explicit error handling.
     * Use this when you need to handle different error types differently.
     *
     * @example
     * const result = await api.login({ username, password }).asResult()
     * if (result.success) {
     *     return result.data
     * } else if (result.type === "VALIDATION_ERROR") {
     *     showValidationErrors(result.errors)
     * } else {
     *     showGenericError(result.message)
     * }
     */
    asResult(): Promise<OK<TSuccess> | TError> {
        return this.promise
    }

    /**
     * Returns the success value or a default value if the request failed.
     * @example
     * const user = await api.getUser(id).orDefault(() => guestUser)
     */
    async orDefault(defaultValue: () => TSuccess): Promise<TSuccess> {
        const result = await this.promise
        if (result.success) {
            return result.data
        } else {
            return defaultValue()
        }
    }

    /**
     * Returns the success value or the result of calling the error handler.
     * @example
     * const user = await api.login(...).or((error) => {
     *     if (error.type === "NOT_AUTHORIZED") {
     *         return guestUser
     *     }
     *     throw error
     * })
     */
    async or(handler: (error: TError) => TSuccess | Promise<TSuccess>): Promise<TSuccess> {
        const result = await this.promise
        if (result.success) {
            return result.data
        } else {
            return handler(result as TError)
        }
    }

    /**
     * Catches errors and returns the result of calling the error handler.
     * Unlike .or(), this allows returning a different type.
     * @example
     * const result = await api.login(...).catch((error) => {
     *     console.error(error.message)
     *     return null
     * })
     */
    async catch<TResult>(handler: (error: TError) => TResult | Promise<TResult>): Promise<TSuccess | TResult> {
        const result = await this.promise
        if (result.success) {
            return result.data
        } else {
            return handler(result as TError)
        }
    }

    /**
     * Transform the success value while preserving error handling behavior.
     * @example
     * const session = await api.login(data).map(async (response) => {
     *     return createSession(response.user)
     * })
     */
    map<TNewSuccess>(fn: (data: TSuccess) => TNewSuccess | Promise<TNewSuccess>): GGPromise<TNewSuccess, TError> {
        const newPromise = this.promise.then(async (result): Promise<OK<TNewSuccess> | TError> => {
            if (result.success) {
                const newData = await fn(result.data)
                return {...result, data: newData} as OK<TNewSuccess>
            } else {
                return result as TError
            }
        })
        return new GGPromise<TNewSuccess, TError>(newPromise)
    }
}
