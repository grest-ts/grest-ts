/**
 * Simple logger utility for verbose/debug output
 * Set GG_API_VERBOSE=true environment variable to enable verbose logging
 */

const VERBOSE = process.env.GG_API_VERBOSE === 'true'

/**
 * Log a message only if verbose mode is enabled
 */
export function verbose(...args: any[]): void {
    if (VERBOSE) {
        console.log(...args)
    }
}

/**
 * Always log (for important messages like errors and completion)
 */
export function log(...args: any[]): void {
    console.log(...args)
}

/**
 * Always log errors
 */
export function error(...args: any[]): void {
    console.error(...args)
}

/**
 * Always log warnings
 */
export function warn(...args: any[]): void {
    console.warn(...args)
}
