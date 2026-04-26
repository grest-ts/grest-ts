/**
 * Walk the loaded ApiDocsDocument once and return an inverted index:
 *
 *   Map<brandName, Array<MethodRef>>
 *
 * Each `MethodRef` carries an occurrence `count` — how many times the brand
 * appears within that method (request body + response + error data + path/
 * query params, summed across all of them). Used by the Brands tab and the
 * reuse popover.
 */

import type {
    ApiDocsDocument, ContractDoc, JsonSchemaDescription, MethodDoc, SchemaRef,
} from "../docTypes";

export interface MethodRef {
    groupSlug: string;
    /** Human-readable group name (used as a sub-header inside the Brands view). */
    groupName: string;
    contract: ContractDoc;
    method: MethodDoc;
    /** Occurrence count of the indexed key (brand or canonicalId) within this method's schemas. Always ≥ 1. */
    count: number;
}

export function buildBrandIndex(doc: ApiDocsDocument): Map<string, MethodRef[]> {
    const index = new Map<string, MethodRef[]>();

    for (const group of doc.groups) {
        for (const contract of group.contracts) {
            for (const method of contract.methods) {
                const counts = collectBrandCountsInMethod(method, doc);
                for (const [brand, count] of counts) {
                    let arr = index.get(brand);
                    if (!arr) { arr = []; index.set(brand, arr); }
                    arr.push({groupSlug: group.slug, groupName: group.name, contract, method, count});
                }
            }
        }
    }

    return index;
}

function collectBrandCountsInMethod(method: MethodDoc, doc: ApiDocsDocument): Map<string, number> {
    const counts = new Map<string, number>();

    const walkRef = (ref: SchemaRef, seen: Set<string>) => {
        if ("ref" in ref) {
            const named = doc.schemas[ref.ref];
            if (named) walkDesc(named.schema, seen);
        } else {
            walkDesc(ref.inline, seen);
        }
    };

    const walkDesc = (desc: JsonSchemaDescription, seen: Set<string>) => {
        if (desc.docs?.brand) {
            counts.set(desc.docs.brand, (counts.get(desc.docs.brand) ?? 0) + 1);
        }
        if (seen.has(desc.canonicalId)) return; // cycle protection on the current path
        const next = new Set(seen);
        next.add(desc.canonicalId);

        const node = desc.node;
        switch (node.kind) {
            case "object":
                for (const p of Object.values(node.properties)) walkDesc(p, next);
                break;
            case "array":
                walkDesc(node.element, next);
                break;
            case "record":
                walkDesc(node.value, next);
                break;
            case "union":
            case "discriminated":
                for (const v of node.variants) walkDesc(v, next);
                break;
            case "tuple":
                for (const e of node.elements) walkDesc(e, next);
                break;
        }
    };

    if (method.requestBody) walkRef(method.requestBody, new Set());
    if (method.successResponse) walkRef(method.successResponse, new Set());
    if (method.wsInput) walkRef(method.wsInput, new Set());
    for (const p of method.pathParams ?? []) walkRef(p.schema, new Set());
    for (const p of method.queryParams ?? []) walkRef(p.schema, new Set());
    for (const t of method.errors) {
        const err = doc.errors[t];
        if (err?.data) walkRef(err.data, new Set());
    }

    return counts;
}
