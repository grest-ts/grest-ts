/**
 * Recursively clones an object and all its nested properties.
 * Handles: primitives, arrays, plain objects, Date, Map, Set.
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj !== 'object') {
        return obj;
    }

    if (obj instanceof Date) {
        return new Date(obj.getTime()) as T;
    }

    if (obj instanceof Map) {
        const clonedMap = new Map();
        for (const [key, value] of obj) {
            clonedMap.set(deepClone(key), deepClone(value));
        }
        return clonedMap as T;
    }

    if (obj instanceof Set) {
        const clonedSet = new Set();
        for (const value of obj) {
            clonedSet.add(deepClone(value));
        }
        return clonedSet as T;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as T;
    }

    const clonedObj: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        clonedObj[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
    return clonedObj as T;
}
