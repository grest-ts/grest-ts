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
}

export function ExampleSchema({schemaRef, doc}: Props) {
    const value = generateExample(schemaRef, doc, new Set());
    return (
        <pre className="text-[13px] leading-6 font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
            <code>{renderJsonValue(value, 0)}</code>
        </pre>
    );
}

// ── Example generation ────────────────────────────────────────────────

type Example =
    | {kind: "primitive"; value: unknown; brand?: string; comment?: string}
    | {kind: "object"; entries: Array<{key: string; value: Example; required: boolean; comment?: string}>}
    | {kind: "array"; items: Example[]; comment?: string}
    | {kind: "null"};

function generateExample(ref: SchemaRef, doc: ApiDocsDocument, seen: Set<string>): Example {
    if ("ref" in ref) {
        if (seen.has(ref.ref)) return {kind: "primitive", value: `<${ref.ref}>`, brand: ref.ref, comment: "(circular)"};
        const named = doc.schemas[ref.ref];
        if (!named) return {kind: "primitive", value: `<${ref.ref}>`};
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
    // Honor explicit example annotations
    if (desc.docs?.example !== undefined) {
        return {kind: "primitive", value: desc.docs.example, brand: namedAs ?? desc.docs.title?.replace(/\s+/g, "")};
    }
    if (desc.docs?.examples && desc.docs.examples.length > 0) {
        return {kind: "primitive", value: desc.docs.examples[0], brand: namedAs ?? desc.docs.title?.replace(/\s+/g, "")};
    }
    if (desc.defaultValue !== undefined) {
        return {kind: "primitive", value: desc.defaultValue, brand: namedAs ?? desc.docs.title?.replace(/\s+/g, "")};
    }

    const node = desc.node;
    switch (node.kind) {
        case "string":
            return {kind: "primitive", value: stringPlaceholder(desc), brand: namedAs ?? desc.docs?.title?.replace(/\s+/g, "")};
        case "number":
            return {kind: "primitive", value: numberPlaceholder(node), brand: namedAs ?? desc.docs?.title?.replace(/\s+/g, "")};
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
            return {kind: "primitive", value: "<binary>", comment: node.accept ? `accepts ${node.accept.join(", ")}` : undefined};
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
                entries: [{key: "<key>", value: generateFromDesc(node.value, doc, seen), required: true, comment: "any string"}],
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

function stringPlaceholder(desc: JsonSchemaDescription): string {
    const fmt = desc.docs?.format;
    if (fmt === "email") return "user@example.com";
    if (fmt === "uri" || fmt === "url") return "https://example.com";
    if (fmt === "date") return "2024-01-15";
    if (fmt === "date-time") return "2024-01-15T12:00:00Z";
    if (fmt === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (fmt === "ip") return "203.0.113.1";
    if (fmt === "phone") return "+15551234567";
    if (fmt === "password") return "********";
    return desc.docs?.title?.replace(/\s+/g, "_").toLowerCase() ?? "string";
}

function numberPlaceholder(node: Extract<JsonSchemaDescription["node"], {kind: "number"}>): number {
    if (node.min !== undefined) return node.min;
    if (node.max !== undefined) return Math.min(node.max, 100);
    return node.integer ? 1 : 1.5;
}

// ── JSON-syntax rendering ──────────────────────────────────────────────

function renderJsonValue(ex: Example, depth: number): React.ReactNode {
    if (ex.kind === "null") return <span className="text-emerald-700">null</span>;

    if (ex.kind === "primitive") {
        const valueRender = renderPrimitive(ex.value);
        const brandComment = ex.brand
            ? <CommentSpan>{ex.comment ? `${ex.brand} — ${ex.comment}` : ex.brand}</CommentSpan>
            : ex.comment
                ? <CommentSpan>{ex.comment}</CommentSpan>
                : null;
        return <>{valueRender}{brandComment && <>  {brandComment}</>}</>;
    }

    if (ex.kind === "array") {
        if (ex.items.length === 0) return <span className="text-gray-500">[]</span>;
        const indent = "  ".repeat(depth + 1);
        const closeIndent = "  ".repeat(depth);
        return (
            <>
                <span className="text-gray-500">[</span>
                {"\n"}
                {ex.items.map((item, i) => (
                    <span key={i}>
                        {indent}
                        {renderJsonValue(item, depth + 1)}
                        {i < ex.items.length - 1 ? <span className="text-gray-500">,</span> : null}
                        {"\n"}
                    </span>
                ))}
                {closeIndent}<span className="text-gray-500">]</span>
            </>
        );
    }

    // object
    if (ex.entries.length === 0) return <span className="text-gray-500">{"{}"}</span>;
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    return (
        <>
            <span className="text-gray-500">{"{"}</span>
            {"\n"}
            {ex.entries.map((entry, i) => (
                <span key={i}>
                    {indent}
                    <span className="text-blue-700">"{entry.key}"</span>
                    <span className="text-gray-500">: </span>
                    {renderJsonValue(entry.value, depth + 1)}
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
