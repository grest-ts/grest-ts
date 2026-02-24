import {IsLiteral, LiteralSchema} from "./IsLiteral";

export const IsEnum = <T extends Record<string, string | number>>(
    enumObj: T
): LiteralSchema<T[keyof T]> => {
    if (enumObj === null || enumObj === undefined || typeof enumObj !== 'object') {
        throw new Error("IsEnum requires an enum object");
    }

    // Filter out reverse mappings for numeric enums
    const values = Object.keys(enumObj)
        .filter(key => isNaN(Number(key)))
        .map(key => enumObj[key]);

    if (values.length === 0) {
        throw new Error("IsEnum requires an enum with at least one value");
    }

    return IsLiteral(...values as any) as LiteralSchema<T[keyof T]>;
};