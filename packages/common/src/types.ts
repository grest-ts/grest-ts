/**
 * Recursively makes all properties of an object optional.
 * Useful for partial matching in tests and validation.
 */
export type DeepPartial<T> = T extends object
    ? T extends Array<infer U>
        ? Array<DeepPartial<U>>
        : { [P in keyof T]?: DeepPartial<T[P]> }
    : T

export type ConstructorOf<T> = new (...args: any[]) => T;

/**
 * Returns the instance of a class. T would be the class reference.
 */
export type InstanceOf<T> = T extends { new(...args: any[]): infer S } ? S : undefined

/**
 * Union of an object's value types. Pair with `enumOf` to replace `enum`:
 * `type Color = Values<typeof Color>`.
 */
export type Values<T> = T[keyof T]