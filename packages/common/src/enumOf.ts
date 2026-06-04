/**
 * Erasable replacement for `enum`: a frozen const object whose values stay
 * literal. Pair with `Values` so one name carries both the value and the type,
 * just like an enum did — but with no runtime construct of its own, so it
 * survives type-stripping (`erasableSyntaxOnly`):
 *
 *   export const Color = enumOf({Red: "red", Green: "green"})
 *   export type Color = Values<typeof Color>
 */
export function enumOf<const T extends Record<string, string | number>>(obj: T): Readonly<T> {
    return Object.freeze(obj);
}
