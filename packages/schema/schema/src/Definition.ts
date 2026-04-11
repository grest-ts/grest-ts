import type {GGSchema} from "./GGSchema";
import {GGIssueKey} from "./issue/GGIssueKey";

import {GGIssuesList} from "./issue/GGIssuesList";

export interface GGSchemaDefinition {
    readonly type: string;
    /**
     * {item?: X | undefined}
     */
    readonly optional?: boolean;
    /**
     * {item: X | null}
     */
    readonly nullable?: boolean;
    readonly brand?: string;
    readonly docs?: GGSchemaDocs;
    readonly defaultValue?: unknown;

    /**
     * Flag indicating whether this schema contains non-JSON-serializable data.
     * Used to determine if multipart encoding is needed for HTTP transport.
     *
     * IMPORTANT: It is set to true also in case any child schema contains non-JSON data!
     */
    readonly hasNonJsonData?: boolean;

    readonly refinements?: readonly GGSchemaRefinement[];
    readonly coercions?: readonly ((value: unknown) => unknown)[];
    readonly clean?: (value: unknown, transform: boolean) => unknown;
    readonly is?: <T>(value: unknown) => value is T;
    readonly isWithErrors?: <T>(value: unknown, errors: GGIssuesList, path: string) => value is T;
}

export interface GGSchemaDocs {
    readonly title?: string;
    readonly description?: string;
    readonly example?: unknown;
    readonly examples?: readonly unknown[];
    readonly deprecated?: boolean;
    /**
     * OpenAPI / JSON Schema format hint (e.g. "email", "date", "uri", "password", "binary").
     * Purely informational — does not affect runtime validation.
     */
    readonly format?: string;
}

export interface GGSchemaRefinement<T = unknown> {
    readonly check: (value: T) => boolean;
    readonly error: GGIssueKey;
}

// --------------------------------------------------
// NON JSON containing data schema
// --------------------------------------------------

/**
 * Result of stringify operation.
 * If extras is empty, the data is pure JSON.
 * If extras has items, multipart encoding is needed.
 */
export interface GGJsonStringifyResult {
    /** JSON string with non-JSON values replaced by null */
    readonly json: string;
    /** Non-JSON values that need special handling (files, binary data, etc.) */
    readonly extras: GGSchemaBinaryData[];
}

/**
 * Binary data format for transport (multipart HTTP, etc.).
 * Uses Blob for lazy loading and streaming support.
 * mimeType available via blob.type, size via blob.size.
 */
export interface GGSchemaBinaryData {
    readonly path: string;
    readonly blob: Blob;
    readonly filename?: string;
}

/**
 * Schema definition marker for types that cannot be JSON-serialized.
 * The schema class should implement encodeToRaw/decodeFromRaw methods.
 */
export interface GGSchemaNonJsonDefinition extends GGSchemaDefinition {
    readonly hasNonJsonData: true;

    encodeToRaw(value: unknown, path: string): Promise<GGSchemaBinaryData>;

    decodeFromRaw(raw: GGSchemaBinaryData): Promise<unknown>;
}

export function isNonJsonDef(def: GGSchemaDefinition): def is GGSchemaNonJsonDefinition {
    const defN = (def as GGSchemaNonJsonDefinition);
    return defN
        && defN.hasNonJsonData === true
        && typeof defN.encodeToRaw === 'function'
        && typeof defN.decodeFromRaw === 'function';
}

// --------------------------------------------------
// TYPES
// --------------------------------------------------

export interface AnyDef extends GGSchemaDefinition {
    readonly type: 'any';
}

export interface UnknownDef extends GGSchemaDefinition {
    readonly type: 'unknown';
}

export interface BitDef extends GGSchemaDefinition {
    readonly type: 'bit';
}

export interface LiteralDef extends GGSchemaDefinition {
    readonly type: 'literal';
    readonly values: readonly LiteralValue[];
}

export type LiteralValue = string | number | boolean;

export interface BooleanDef extends GGSchemaDefinition {
    readonly type: 'boolean';
}

export interface NumberDef extends GGSchemaDefinition {
    readonly type: 'number' | 'int' | 'uint' | 'posInt' | 'int8' | 'int16' | 'int32' | 'uint8' | 'uint16' | 'uint32';
    readonly min?: number;
    readonly max?: number;
    readonly integer?: boolean;
    readonly multipleOf?: number;
}

export interface StringDef extends GGSchemaDefinition {
    readonly type: 'string';
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly pattern?: RegExp;
    readonly nonEmpty?: boolean;
    readonly trim?: boolean;
}

export interface ObjectDef extends GGSchemaDefinition {
    readonly type: 'object';
    readonly shape?: ShapeInput;
}

export interface ArrayDef extends GGSchemaDefinition {
    readonly type: 'array';
    readonly element?: GGSchema<any>;
    readonly elementFactory?: () => GGSchema<any>;
    readonly minLength?: number;
    readonly maxLength?: number;
}

export type ShapeInput = Record<string, GGSchema<any> | LiteralValue>;

export interface RecordDef extends GGSchemaDefinition {
    readonly type: 'record';
    readonly key: GGSchema<string>;
    readonly value: GGSchema<any>;
}

export interface DiscriminatedDef extends GGSchemaDefinition {
    readonly type: 'discriminated';
    readonly discriminator: string;
    readonly variantMap?: ReadonlyMap<string | number | boolean, GGSchema<any>>;
}

export interface TupleDef extends GGSchemaDefinition {
    readonly type: 'tuple';
    readonly elements?: readonly GGSchema<any>[];
}

export interface UnionDef extends GGSchemaDefinition {
    readonly type: 'union';
    readonly variants: readonly GGSchema<any>[];
}

// Union of all schema definition types
export type AnyStandardSchemaDef =
    | AnyDef
    | ArrayDef
    | BitDef
    | BooleanDef
    | DiscriminatedDef
    | LiteralDef
    | NumberDef
    | ObjectDef
    | RecordDef
    | StringDef
    | TupleDef
    | UnionDef
    | UnknownDef;

