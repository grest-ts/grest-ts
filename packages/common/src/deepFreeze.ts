/**
 * Recursively freezes an object and all its nested properties.
 * Used to create immutable objects.
 */
export function deepFreeze<T>(o: T): T {
    if (o === undefined) {
        return o;
    }
    Object.freeze(o);
    Object.getOwnPropertyNames(o).forEach(function (prop) {
        if (prop === "renderers") {
            return;
        }
        if ((o as any)[prop] !== null
            && (typeof (o as any)[prop] === "object" || typeof (o as any)[prop] === "function")
            && !Object.isFrozen((o as any)[prop])) {
            deepFreeze((o as any)[prop]);
        }
    });
    return o;
}
