/**
 * Cross-realm singleton helper.
 *
 * Stashes a value on `globalThis` under a `Symbol.for(key)` slot so that
 * physically duplicate copies of the same module (bundled vs. node_modules,
 * pnpm strict isolation, multiple major versions, etc.) share one instance.
 *
 * The first caller installs the value; subsequent callers — even from a
 * different copy of the module — read the existing value back. This is the
 * load-twice-survival pattern used by React, styled-components, etc.
 */
export function getOrInstallGlobal<T>(key: string, factory: () => T): T {
    const sym = Symbol.for(key);
    const slot = globalThis as Record<symbol, unknown>;
    const existing = slot[sym];
    if (existing !== undefined) {
        return existing as T;
    }
    const instance = factory();
    slot[sym] = instance;
    return instance;
}

/**
 * Reads the current value at `Symbol.for(key)` without installing one.
 */
export function getGlobal<T>(key: string): T | undefined {
    return (globalThis as Record<symbol, unknown>)[Symbol.for(key)] as T | undefined;
}

/**
 * Writes a value at `Symbol.for(key)`. If a `predicate` is provided, the
 * write only happens when the predicate returns true for the existing
 * value (use this to make `_init`-style replacement idempotent across
 * duplicate copies — e.g. only replace if the existing entry is still
 * the browser default).
 */
export function setGlobal<T>(key: string, value: T, predicate?: (existing: T | undefined) => boolean): void {
    const sym = Symbol.for(key);
    const slot = globalThis as Record<symbol, unknown>;
    if (predicate && !predicate(slot[sym] as T | undefined)) {
        return;
    }
    slot[sym] = value;
}
