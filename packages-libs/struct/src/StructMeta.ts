export interface StructMeta {
    name: string;
    path: string;
    idTsType: string;
    idTsTypeDefinition?: string;
    useExport: boolean;
    useDirty: boolean;
    useNew: boolean;
    chunks: ChunkMeta[];
}

export interface ChunkMeta {
    bits: number;
    sourceBits: number;
    properties: PropertyMeta[];
}

export interface PropertyMeta {
    name: string;
    type: DataType;
    offset: number;
    bits: 64 | 32 | 16 | 8 | 1;
    tsType?: string;
    tsTypeImport?: string;
    tsTypeDefinition?: string;
    addMath?: boolean;
    mustExist?: boolean;
    mask?: number;
}

export type DataType = "int8" | "int16" | "int32" | "uint8" | "uint16" | "uint32" | "float32" | "float64" | "bool" | "bit"

export type AnyTypeArray = Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;