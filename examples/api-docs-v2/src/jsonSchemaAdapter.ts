/**
 * Convert grest-ts's in-memory `GGSchemaDescription` into the JSON-safe
 * `JsonSchemaDescription`. The only difference is that the GGSchema instance
 * references (`schema`, `canonical`) are swapped for stable string IDs based
 * on canonical identity.
 *
 * Same identity rule the openapi package's SchemaRegistry uses: two
 * descriptions with the same canonical schema get the same `canonicalId`,
 * so consumers can deduplicate without touching the in-memory schema graph.
 */

import type {GGSchema, GGSchemaDescription} from "@grest-ts/schema";
import type {JsonSchemaDescription, JsonSchemaNodeKind} from "./docTypes";

export class JsonSchemaAdapter {
    /** GGSchema instance → stable string id. Keyed by canonical when present. */
    private readonly idsBySchema = new Map<GGSchema<any>, string>();
    private nextId = 0;

    /** Convert a GGSchemaDescription → JsonSchemaDescription, recursing into composites. */
    convert(desc: GGSchemaDescription): JsonSchemaDescription {
        return {
            canonicalId: this.idFor(desc.canonical ?? desc.schema),
            node: this.convertNode(desc.node),
            ...(desc.docs ? {docs: desc.docs} : {}),
            ...(desc.defaultValue !== undefined ? {defaultValue: desc.defaultValue} : {}),
            nullable: desc.nullable,
            optional: desc.optional,
        };
    }

    private idFor(schema: GGSchema<any>): string {
        let id = this.idsBySchema.get(schema);
        if (id === undefined) {
            id = `s${this.nextId++}`;
            this.idsBySchema.set(schema, id);
        }
        return id;
    }

    private convertNode(node: GGSchemaDescription["node"]): JsonSchemaNodeKind {
        switch (node.kind) {
            case "string":
            case "number":
            case "boolean":
            case "bit":
            case "any":
            case "unknown":
            case "literal":
            case "file":
            case "password":
                // Primitive / leaf — JSON-safe as-is.
                return node;

            case "array":
                return {
                    ...node,
                    element: this.convert(node.element),
                };

            case "object":
                return {
                    ...node,
                    properties: Object.fromEntries(
                        Object.entries(node.properties).map(([k, v]) => [k, this.convert(v)])
                    ),
                };

            case "record":
                return {kind: "record", value: this.convert(node.value)};

            case "union":
                return {kind: "union", variants: node.variants.map(v => this.convert(v))};

            case "discriminated":
                return {
                    kind: "discriminated",
                    discriminator: node.discriminator,
                    variants: node.variants.map(v => this.convert(v)),
                };

            case "tuple":
                return {kind: "tuple", elements: node.elements.map(e => this.convert(e))};

            default: {
                // exhaustive
                const _never: never = node;
                throw new Error(`JsonSchemaAdapter: unsupported node kind ${(node as any).kind}`);
            }
        }
    }
}
