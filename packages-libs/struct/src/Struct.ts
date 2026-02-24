export interface StructConfig {
    /**
     * Defines if this pool will also support transferable features (export, dirty tracking, etc...)
     */
    useExport?: boolean
    /**
     * We assume we want to track dirty objects.
     */
    useDirty?: boolean;
    /**
     * We assume all objects are always filled, you can't allocate new objects. (useful for map terrain data for example - all tiles are usually terrain)
     */
    useNew?: boolean
}

export function typed<Type>(defaultValue: number = 0): Type {
    return defaultValue as Type;
}

export const ADD_MATH = "__addMath";

export const MUST_EXIST = "__mustExist";

export class Struct<RefType extends number, DataType> {

    constructor(config?: StructConfig) {
        String(config);
    }

    public ref<RefType extends number>(): Struct<RefType, DataType> {
        return this as any;
    }

    public buffer(): this {
        return this;
    }

    public existenceCheck<Name extends keyof DataType>(...name: Name[]): this {
        return this as any;
    }

    public int8<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public int16<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public int32<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public uint8<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public uint16<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public uint32<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public float32<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public float64<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public bool<Name extends string, Type extends boolean = boolean>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public bit<Name extends string, Type extends number = number>(name: Name, ...type: (Type | typeof ADD_MATH | typeof MUST_EXIST)[]): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

    public structArray<Name extends string, Type>(name: Name, type: Type): Struct<RefType, DataType & Record<Name, Type>> {
        return this as any;
    }

}
