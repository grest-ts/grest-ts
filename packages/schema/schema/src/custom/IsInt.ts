import {NumberSchema} from "../schemas/IsNumber";

// Branded types (exported so declaration emit can reference them in downstream .d.ts files)
export interface int extends Number {
    readonly type: "int"
}

export interface int8 extends Number {
    readonly type: "int8"
}

export interface int16 extends Number {
    readonly type: "int16"
}

export interface int32 extends Number {
    readonly type: "int32"
}

export interface uint extends Number {
    readonly type: "uint"
}

export interface uint8 extends Number {
    readonly type: "uint8"
}

export interface uint16 extends Number {
    readonly type: "uint16"
}

export interface uint32 extends Number {
    readonly type: "uint32"
}

export const IsInt = new NumberSchema<number & int>({type: 'int', integer: true});
export type tInt = typeof IsInt.infer;
export const IsUint = new NumberSchema<number & uint>({type: 'uint', integer: true, min: 0});
export type tUint = typeof IsUint.infer;
export const IsUint8 = new NumberSchema<number & uint8>({type: 'uint8', integer: true, min: 0, max: 255});
export type tUint8 = typeof IsUint8.infer;
export const IsUint16 = new NumberSchema<number & uint16>({type: 'uint16', integer: true, min: 0, max: 65535});
export type tUint16 = typeof IsUint16.infer;
export const IsUint32 = new NumberSchema<number & uint32>({type: 'uint32', integer: true, min: 0, max: 4294967295});
export type tUint32 = typeof IsUint32.infer;
export const IsInt8 = new NumberSchema<number & int8>({type: 'int8', integer: true, min: -128, max: 127});
export type tInt8 = typeof IsInt8.infer;
export const IsInt16 = new NumberSchema<number & int16>({type: 'int16', integer: true, min: -32768, max: 32767});
export type tInt16 = typeof IsInt16.infer;
export const IsInt32 = new NumberSchema<number & int32>({type: 'int32', integer: true, min: -2147483648, max: 2147483647});
export type tInt32 = typeof IsInt32.infer;

// Positive integer (> 0)
export interface posInt extends Number {
    readonly type: "posInt"
}
export const IsPosInt = new NumberSchema<number & posInt>({type: 'posInt', integer: true, min: 1});
export type tPosInt = typeof IsPosInt.infer;
