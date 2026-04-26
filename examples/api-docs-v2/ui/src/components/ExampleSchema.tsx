/**
 * ExampleSchema — generates a representative JSON example from a schema and
 * renders it as a syntax-highlighted code block.
 *
 * Sources of example values, in priority:
 *   1. desc.docs.example       — explicit per-field example
 *   2. desc.docs.examples[0]   — first of a list
 *   3. desc.defaultValue       — falls back to the default
 *   4. Brand-aware placeholder — e.g. EmailAddress → "user@example.com"
 *   5. Generic placeholder by primitive kind
 *
 * For composites: walks recursively. Optional fields are included with their
 * example value (so the user sees them); the renderer marks optional keys
 * with a comment `// optional`.
 */

import type {ApiDocsDocument, JsonSchemaDescription, SchemaRef} from "../docTypes";

interface Props {
    schemaRef: SchemaRef;
    doc: ApiDocsDocument;
    /** When set, brand comments matching this value get a yellow accent. */
    /** Type identifier (brand or `__<canonicalId>`) to accent in the example. */
    highlightType?: string;
}

export function ExampleSchema({schemaRef, doc, highlightType}: Props) {
    const value = generateExample(schemaRef, doc, new Set());
    return (
        <pre className="text-[13px] leading-6 font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
            <code>{renderJsonValue(value, 0, highlightType)}</code>
        </pre>
    );
}

// ── Example generation ────────────────────────────────────────────────

type Example =
    | {kind: "primitive"; value: unknown; brand?: string; comment?: string}
    | {kind: "object"; entries: Array<{key: string; value: Example; required: boolean; comment?: string}>; brand?: string}
    | {kind: "array"; items: Example[]; brand?: string; comment?: string}
    | {kind: "null"};

/**
 * Convert a raw JS value (typically `desc.docs.example`) into the structured
 * Example tree. Handles arbitrarily nested objects and arrays so they get
 * pretty-printed with indentation rather than collapsed via JSON.stringify.
 */
function valueToExample(value: unknown, brand?: string): Example {
    if (value === null || value === undefined) return {kind: "null"};
    if (Array.isArray(value)) {
        return {
            kind: "array",
            items: value.map(v => valueToExample(v)),
            ...(brand ? {brand} : {}),
        };
    }
    if (typeof value === "object") {
        return {
            kind: "object",
            entries: Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
                key,
                value: valueToExample(v),
                required: true,
            })),
            ...(brand ? {brand} : {}),
        };
    }
    return {kind: "primitive", value, ...(brand ? {brand} : {})};
}

function generateExample(ref: SchemaRef, doc: ApiDocsDocument, seen: Set<string>): Example {
    if ("ref" in ref) {
        if (seen.has(ref.ref)) return {kind: "primitive", value: `some${ref.ref}`, brand: ref.ref, comment: "(circular)"};
        const named = doc.schemas[ref.ref];
        if (!named) return {kind: "primitive", value: `some${ref.ref}`};
        const nextSeen = new Set(seen);
        nextSeen.add(ref.ref);
        return generateFromDesc(named.schema, doc, nextSeen, ref.ref);
    }
    return generateFromDesc(ref.inline, doc, seen);
}

function generateFromDesc(
    desc: JsonSchemaDescription,
    doc: ApiDocsDocument,
    seen: Set<string>,
    namedAs?: string,
): Example {
    // Brand annotation for primitives is "<baseType> & <BrandName>" so the
    // underlying type stays visible even when the schema has a named title.
    // Prefer explicit `docs.brand` (auto-populated by `.brand("UserId")`),
    // fall back to whitespace-stripped title for legacy schemas, and finally
    // fall back to the named-as parameter (used when this is a top-level $ref).
    const brandTitle = namedAs
        ?? desc.docs?.brand
        ?? desc.docs?.title?.replace(/\s+/g, "");
    const baseType = brandedBaseTypeLabel(desc);
    const brand = brandTitle
        ? (baseType ? `${baseType} & ${brandTitle}` : brandTitle)
        : undefined;

    // Honor explicit example annotations.
    // Use valueToExample so object/array examples get pretty-printed instead
    // of collapsed onto a single line by JSON.stringify in the primitive renderer.
    if (desc.docs?.example !== undefined) {
        return valueToExample(desc.docs.example, brand);
    }
    if (desc.docs?.examples && desc.docs.examples.length > 0) {
        return valueToExample(desc.docs.examples[0], brand);
    }
    if (desc.defaultValue !== undefined) {
        return valueToExample(desc.defaultValue, brand);
    }

    const node = desc.node;
    switch (node.kind) {
        case "string":
            return {kind: "primitive", value: stringPlaceholder(desc), brand};
        case "number":
            return {kind: "primitive", value: numberPlaceholder(node), brand};
        case "boolean":
            return {kind: "primitive", value: true};
        case "bit":
            return {kind: "primitive", value: 1};
        case "literal":
            return {kind: "primitive", value: node.values[0]};
        case "any":
        case "unknown":
            return {kind: "primitive", value: null};
        case "file":
            return {kind: "primitive", value: "someBinary", comment: node.accept ? `accepts ${node.accept.join(", ")}` : undefined};
        case "password":
            return {kind: "primitive", value: "********"};

        case "array": {
            const itemExample = generateFromDesc(node.element, doc, seen);
            const minItems = node.minItems ?? 0;
            const sample: Example[] = [itemExample];
            if (minItems > 1) sample.push(itemExample);
            return {kind: "array", items: sample};
        }

        case "object": {
            const entries: Array<{key: string; value: Example; required: boolean; comment?: string}> = [];
            for (const [key, propDesc] of Object.entries(node.properties)) {
                const required = node.required.includes(key);
                const value = generateFromDesc(propDesc, doc, seen);
                const comment = required ? undefined : "optional";
                entries.push({key, value, required, comment});
            }
            return {kind: "object", entries};
        }

        case "record":
            return {
                kind: "object",
                entries: [{key: "someKey", value: generateFromDesc(node.value, doc, seen), required: true, comment: "any string"}],
            };

        case "tuple":
            return {kind: "array", items: node.elements.map(e => generateFromDesc(e, doc, seen))};

        case "union":
            // Pick first non-null variant
            return generateFromDesc(node.variants[0], doc, seen);

        case "discriminated":
            return generateFromDesc(node.variants[0], doc, seen);

        default:
            return {kind: "primitive", value: null};
    }
}

/**
 * Underlying primitive label shown next to a brand name (`string & UserId`).
 * Format hint is dropped when the brand is present — the brand already implies
 * the semantic role; format would just be duplication.
 */
function brandedBaseTypeLabel(desc: JsonSchemaDescription): string | undefined {
    const node = desc.node;
    switch (node.kind) {
        case "string":   return "string";
        case "number":   return node.integer ? "integer" : "number";
        case "boolean":  return "boolean";
        case "bit":      return "0|1";
        case "literal":  return undefined; // brand on a literal is unusual; skip the prefix
        case "file":     return "binary";
        case "password": return "string";
        default:         return undefined;
    }
}

/**
 * Generic placeholder for a string field that has no `docs.example`.
 *
 * Format: `someBrandName` / `someString` — camelCase'd so a double-click
 * selects the whole token in a browser (angle brackets like `<string>`
 * would split the selection on the brackets). Easy to copy and replace.
 *
 * Deliberately does NOT have any format-specific hardcoding (no
 * `if (format === "email") return "user@example.com"`). If contract authors
 * want canonical values like that, they should set `.docs({example: ...})` on
 * the brand definition itself — that's the source of truth. The docs UI's job
 * is to display what the contract says, not to invent it.
 */
function stringPlaceholder(desc: JsonSchemaDescription): string {
    const brand = desc.docs?.brand ?? desc.docs?.title?.replace(/\s+/g, "");
    if (brand) return `some${brand[0].toUpperCase()}${brand.slice(1)}`;
    return "someString";
}

function numberPlaceholder(node: Extract<JsonSchemaDescription["node"], {kind: "number"}>): number {
    if (node.min !== undefined) return node.min;
    if (node.max !== undefined) return Math.min(node.max, 100);
    // Default 100 — looks more "real" than 1, doesn't pretend to be exact like 1.5
    return 100;
}

// ── JSON-syntax rendering ──────────────────────────────────────────────

function renderJsonValue(ex: Example, depth: number, hl?: string): React.ReactNode {
    if (ex.kind === "null") return <span className="text-emerald-700">null</span>;

    if (ex.kind === "primitive") {
        const valueRender = renderPrimitive(ex.value);
        const brandComment = ex.brand
            ? <BrandCommentSpan brand={ex.brand} comment={ex.comment} hl={hl} />
            : ex.comment
                ? <CommentSpan>{ex.comment}</CommentSpan>
                : null;
        return <>{valueRender}{brandComment && <>  {brandComment}</>}</>;
    }

    if (ex.kind === "array") {
        if (ex.items.length === 0) return (
            <>
                <span className="text-gray-500">[]</span>
                {ex.brand && <>  <BrandCommentSpan brand={ex.brand} hl={hl} /></>}
            </>
        );
        const indent = "  ".repeat(depth + 1);
        const closeIndent = "  ".repeat(depth);
        return (
            <>
                <span className="text-gray-500">[</span>
                {ex.brand && <>  <BrandCommentSpan brand={ex.brand} hl={hl} /></>}
                {"\n"}
                {ex.items.map((item, i) => (
                    <span key={i}>
                        {indent}
                        {renderJsonValue(item, depth + 1, hl)}
                        {i < ex.items.length - 1 ? <span className="text-gray-500">,</span> : null}
                        {"\n"}
                    </span>
                ))}
                {closeIndent}<span className="text-gray-500">]</span>
            </>
        );
    }

    if (ex.entries.length === 0) return (
        <>
            <span className="text-gray-500">{"{}"}</span>
            {ex.brand && <>  <BrandCommentSpan brand={ex.brand} hl={hl} /></>}
        </>
    );
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    return (
        <>
            <span className="text-gray-500">{"{"}</span>
            {ex.brand && <>  <BrandCommentSpan brand={ex.brand} hl={hl} /></>}
            {"\n"}
            {ex.entries.map((entry, i) => (
                <span key={i} className={isBrandLeaf(entry.value, hl) ? "bg-yellow-100 -mx-1 px-1 rounded" : ""}>
                    {indent}
                    <span className="text-blue-700">"{entry.key}"</span>
                    <span className="text-gray-500">: </span>
                    {renderJsonValue(entry.value, depth + 1, hl)}
                    {i < ex.entries.length - 1 ? <span className="text-gray-500">,</span> : null}
                    {entry.comment && <>  <CommentSpan>{entry.comment}</CommentSpan></>}
                    {"\n"}
                </span>
            ))}
            {closeIndent}<span className="text-gray-500">{"}"}</span>
        </>
    );
}

function renderPrimitive(value: unknown): React.ReactNode {
    if (value === null) return <span className="text-emerald-700">null</span>;
    if (value === undefined) return <span className="text-emerald-700">null</span>;
    if (typeof value === "string") return <span className="text-emerald-700">{JSON.stringify(value)}</span>;
    if (typeof value === "number" || typeof value === "boolean") return <span className="text-emerald-700">{String(value)}</span>;
    return <span className="text-emerald-700">{JSON.stringify(value)}</span>;
}

function CommentSpan({children}: {children: React.ReactNode}) {
    return <span className="text-gray-400 italic">{`// ${children}`}</span>;
}

/**
 * Brand-aware variant of CommentSpan. The brand name within the comment
 * gets a yellow highlight when it matches the active highlightBrand. Brand
 * may be `"baseType & BrandName"` or just `"BrandName"`; we extract the
 * trailing identifier and highlight it specifically.
 */
function BrandCommentSpan({brand, comment, hl}: {brand: string; comment?: string; hl?: string}) {
    const trailing = brand.includes(" & ") ? brand.split(" & ").pop()! : brand;
    const isHl = hl === trailing;
    const text = comment ? `${brand} — ${comment}` : brand;
    if (!isHl) return <CommentSpan>{text}</CommentSpan>;
    return (
        <span className="text-gray-400 italic">
            <span>// </span>
            <span className="bg-yellow-200 ring-1 ring-yellow-400 px-0.5 rounded text-purple-700 font-semibold not-italic">
                {text}
            </span>
        </span>
    );
}

/**
 * Does this Example *itself* carry the highlighted brand (NOT recursing into
 * children)? Used to background-tint exactly the row whose value is the
 * branded leaf, without spreading the highlight up through its ancestors.
 */
function isBrandLeaf(ex: Example, hl?: string): boolean {
    if (!hl) return false;
    if (ex.kind === "null") return false;
    const brand = (ex as {brand?: string}).brand;
    if (!brand) return false;
    const trailing = brand.includes(" & ") ? brand.split(" & ").pop()! : brand;
    return trailing === hl;
}
