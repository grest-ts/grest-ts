/**
 * Secret - A wrapper for sensitive values that prevents accidental logging.
 *
 * Secrets are automatically redacted when:
 * - Converted to string (toString)
 * - Serialized to JSON (toJSON)
 * - Logged with console.log or util.inspect
 *
 * To access the actual value, you must explicitly call unwrap().
 *
 * @example
 * ```typescript
 * const dbPassword = new Secret('super-secret-password');
 *
 * console.log(dbPassword);           // "[REDACTED]"
 * console.log(JSON.stringify(dbPassword)); // "[REDACTED]"
 *
 * // Explicit unwrap required to get value
 * const password = dbPassword.unwrap();
 * ```
 */
export class Secret {
    #value: string;
    constructor(value: string) {
        this.#value = value;
    }

    /**
     * Get the actual secret value.
     * Use with care - avoid logging the result.
     */
    unwrap(): string {
        return this.#value;
    }

    /**
     * Check if the secret has a non-empty value.
     */
    hasValue(): boolean {
        return this.#value.length > 0;
    }

    /**
     * Compare with another secret without exposing either value.
     */
    equals(other: Secret): boolean {
        return this.#value === other.#value;
    }

    // Prevent accidental logging/serialization

    toString(): string {
        return '[REDACTED]';
    }

    toJSON(): string {
        return '[REDACTED]';
    }

    // Node.js console.log and util.inspect use this
    [Symbol.for('nodejs.util.inspect.custom')](): string {
        return '[REDACTED]';
    }

    // Prevent valueOf from leaking
    valueOf(): string {
        return '[REDACTED]';
    }
}

/**
 * Type guard to check if a value is a Secret.
 */
export function isSecret(value: unknown): value is Secret {
    return value instanceof Secret;
}
