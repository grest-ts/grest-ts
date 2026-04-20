import type {GGSchema} from "./GGSchema";
import type {GGSchemaDocs} from "./Definition";

/**
 * The structural content of a schema — what type it is and its constraints.
 * Format-agnostic: no OpenAPI, JSON Schema, or Protobuf types.
 *
 * Composite types (object, array, etc.) contain their children as
 * GGSchemaDescription so consumers can walk the tree without needing
 * to know the schema library's internal def structure.
 */
export type GGSchemaNodeKind =
    | { kind: 'string'; minLength?: number; maxLength?: number; pattern?: string }
    | { kind: 'number'; integer: boolean; min?: number; max?: number; multipleOf?: number }
    | { kind: 'boolean' }
    | { kind: 'bit' }
    | { kind: 'literal'; values: readonly (string | number | boolean)[] }
    | { kind: 'array'; element: GGSchemaDescription; minItems?: number; maxItems?: number }
    | { kind: 'object'; properties: Record<string, GGSchemaDescription>; required: string[]; additionalProperties: false }
    | { kind: 'record'; value: GGSchemaDescription }
    | { kind: 'union'; variants: GGSchemaDescription[] }
    | { kind: 'discriminated'; discriminator: string; variants: GGSchemaDescription[] }
    | { kind: 'tuple'; elements: GGSchemaDescription[] }
    | { kind: 'any' }
    | { kind: 'unknown' }
    | { kind: 'file'; accept?: readonly string[]; maxSize?: number }
    | { kind: 'password'; minLength: number; maxLength: number }

/**
 * Complete description of a schema at a specific usage site.
 *
 * - `node` — the structural content (what type, what constraints)
 * - `schema` — back-reference to the originating GGSchema (identity key for registries)
 * - `canonical` — if this is a presentational variant (via .orUndefined, .docs(), etc.),
 *   points to the base structural schema. Consumers use this for deduplication: if two
 *   descriptions share the same canonical, they represent the same underlying type.
 * - `docs` — annotations (title, description, example, format, deprecated)
 * - `defaultValue` — value to use when field is absent
 * - `nullable` — whether null is a valid value (from .orNull)
 * - `optional` — whether undefined is a valid value (from .orUndefined); affects
 *   parent object's required[] but does not change the node schema itself
 */
export interface GGSchemaDescription {
    readonly schema: GGSchema<any>;
    readonly canonical?: GGSchema<any>;
    readonly node: GGSchemaNodeKind;
    readonly docs?: GGSchemaDocs;
    readonly defaultValue?: unknown;
    readonly nullable: boolean;
    readonly optional: boolean;
}
