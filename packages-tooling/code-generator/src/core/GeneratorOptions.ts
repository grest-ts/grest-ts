/**
 * Configuration options for code generation
 *
 * These options are typically passed to API parsers.
 * For generator-wide config, see GeneratorConfig in Project.ts
 */
export interface GeneratorOptions {
    /**
     * Allow null type in API definitions
     *
     * When false (default):
     * - null types are rejected with an error
     * - Use undefined for optional values instead: `param?: Type`
     *
     * When true:
     * - null types are allowed (useful for database interop, external APIs)
     *
     * @default false
     */
    allowNull?: boolean
}

/**
 * Default generator options
 */
export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
    allowNull: false,
}

/**
 * Merge user options with defaults
 */
export function mergeOptions(userOptions?: GeneratorOptions): GeneratorOptions {
    return {
        ...DEFAULT_GENERATOR_OPTIONS,
        ...userOptions
    }
}
