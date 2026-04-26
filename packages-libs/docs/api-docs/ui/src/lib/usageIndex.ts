/**
 * Usage index keyed by `canonicalId` plus a separate namespace for error
 * types — runtime-identity-based "where does this exact schema flow?" lookup.
 *
 * Two `IsObject({...})` calls in different files produce different schemas
 * even if structurally identical, so this only sees TRUE reuse — same
 * `const X = ...` referenced from multiple methods. Same applies for brands
 * (already auto-populate `docs.brand`) and named types.
 *
 * **Error types** live in their own namespace because they aren't schemas in
 * the canonical-id sense — they're framework `ERROR.define(...)` constants
 * shared by name. Indexed under key `__error_<TYPE>` (e.g. `__error_NOT_AUTHORIZED`).
 * The `__error_` prefix avoids collision with brand names or anonymous
 * `__<canonicalId>` keys.
 *
 * **Skipped** to keep noise low: bare primitives without a brand or title
 * (raw `IsString`, `IsNumber`, …). They appear in nearly every method and
 * provide no signal.
 */

import type {
    ApiDocsDocument, JsonSchemaDescription, MethodDoc, SchemaRef,
} from "../docTypes";
import type {MethodRef} from "./brandIndex";

export type UsageIndex = Map<string, MethodRef[]>;

/** URL/identifier prefix for error types in the highlight namespace. */
export const ERROR_TYPE_PREFIX = "__error_";

export function buildUsageIndex(doc: ApiDocsDocument): UsageIndex {
    const index = new Map<string, MethodRef[]>();
    const schemaByCanonical = new Map<string, JsonSchemaDescription>();
    for (const [, named] of Object.entries(doc.schemas)) {
        schemaByCanonical.set(named.schema.canonicalId, named.schema);
    }

    for (const group of doc.groups) {
        for (const contract of group.contracts) {
            for (const method of contract.methods) {
                // 1) Schema-level usage (canonicalIds)
                const schemaCounts = collectCanonicalCountsInMethod(method, doc, schemaByCanonical);
                for (const [id, count] of schemaCounts) {
                    const desc = schemaByCanonical.get(id);
                    if (!desc) continue;
                    if (!isInteresting(desc)) continue;
                    let arr = index.get(id);
                    if (!arr) { arr = []; index.set(id, arr); }
                    arr.push({groupSlug: group.slug, groupName: group.name, contract, method, count});
                }

                // 2) Error types — each declared error counts as one occurrence
                //    in this method, regardless of payload shape.
                for (const errType of method.errors) {
                    const key = ERROR_TYPE_PREFIX + errType;
                    let arr = index.get(key);
                    if (!arr) { arr = []; index.set(key, arr); }
                    arr.push({groupSlug: group.slug, groupName: group.name, contract, method, count: 1});
                }
            }
        }
    }

    return index;
}

function isInteresting(desc: JsonSchemaDescription): boolean {
    if (desc.docs?.brand) return true;
    if (desc.docs?.title) return true;
    const node = desc.node;
    const k = node.kind;
    if (k === "object" || k === "discriminated" || k === "union"
        || k === "tuple" || k === "record") return true;
    if (k === "literal" && (node as any).values.length > 1) return true;
    return false;
}

/** For each canonicalId reachable from this method, count occurrences. */
function collectCanonicalCountsInMethod(
    method: MethodDoc,
    doc: ApiDocsDocument,
    schemaByCanonical: Map<string, JsonSchemaDescription>,
): Map<string, number> {
    const counts = new Map<string, number>();

    const visit = (desc: JsonSchemaDescription, seen: Set<string>) => {
        counts.set(desc.canonicalId, (counts.get(desc.canonicalId) ?? 0) + 1);
        if (!schemaByCanonical.has(desc.canonicalId)) {
            schemaByCanonical.set(desc.canonicalId, desc);
        }
        if (seen.has(desc.canonicalId)) return; // cycle protection
        const next = new Set(seen);
        next.add(desc.canonicalId);
        const node = desc.node;
        switch (node.kind) {
            case "object":
                for (const p of Object.values(node.properties)) visit(p, next);
                break;
            case "array":
                visit(node.element, next);
                break;
            case "record":
                visit(node.value, next);
                break;
            case "union":
            case "discriminated":
                for (const v of node.variants) visit(v, next);
                break;
            case "tuple":
                for (const e of node.elements) visit(e, next);
                break;
        }
    };

    const visitRef = (ref: SchemaRef) => {
        if ("ref" in ref) {
            const named = doc.schemas[ref.ref];
            if (named) visit(named.schema, new Set());
        } else {
            visit(ref.inline, new Set());
        }
    };

    if (method.requestBody) visitRef(method.requestBody);
    if (method.successResponse) visitRef(method.successResponse);
    if (method.wsInput) visitRef(method.wsInput);
    for (const p of method.pathParams ?? []) visitRef(p.schema);
    for (const p of method.queryParams ?? []) visitRef(p.schema);
    for (const t of method.errors) {
        const err = doc.errors[t];
        if (err?.data) visitRef(err.data);
    }

    return counts;
}
