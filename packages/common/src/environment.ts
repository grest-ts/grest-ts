/**
 * Environment detection utilities that work without DOM lib
 * Uses type assertions to avoid TypeScript errors in Node-only contexts
 */

// Declare window type to avoid TS errors when DOM lib is not included
declare const window: { document?: unknown } | undefined

/**
 * Check if code is running in a browser environment
 * Works in both Node.js and browser contexts without requiring DOM lib
 */
export function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.document !== 'undefined'
}

/**
 * Check if code is running in a Node.js environment
 */
export function isNode(): boolean {
    return !isBrowser()
}
