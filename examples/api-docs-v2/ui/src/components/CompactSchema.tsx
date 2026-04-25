/**
 * CompactSchema — renders any JsonSchemaDescription as a TypeScript-like
 * compact form inside a code block. One line per simple field; multi-line
 * only for nested composites. Types are syntax-colored, brands clickable,
 * constraints as inline pill-comments.
 *
 * Tradeoff vs the verbose multi-line form: density wins for common cases;
 * descriptions and examples render as muted line-comments after the type.
 */

import type {ApiDocsDocument, JsonSchemaDescription, SchemaRef} from "../docTypes";

interface Props {
    schemaRef: SchemaRef;
    doc: ApiDocsDocument;
    /** Show wrapping `{` `}` braces — false when used inline. */
    bare?: boolean;
}

export function CompactSchema({schemaRef, doc, bare}: Props) {
    return (
        <pre className="text-[13px] leading-6 font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
            <code>
                {renderRef(schemaRef, doc, 0, bare ?? false)}
            </code>
        </pre>
    );
}

// ── Recursive rendering ────────────────────────────────────────────────

function renderRef(ref: SchemaRef, doc: ApiDocsDocument, depth: number, bare: boolean): React.ReactNode {
    if ("ref" in ref) {
        const named = doc.schemas[ref.ref];
        if (!named) return <span className="text-red-500">unknown:{ref.ref}</span>;
        // Top-level $ref — render the named schema's inner shape inline.
        return renderDesc(named.schema, doc, depth, bare, ref.ref);
    }
    return renderDesc(ref.inline, doc, depth, bare);
}

function renderDesc(
    desc: JsonSchemaDescription,
    doc: ApiDocsDocument,
    depth: number,
    bare: boolean,
    namedAs?: string,
): React.ReactNode {
    const node = desc.node;
    switch (node.kind) {
        case "object":
            return renderObject(node as any, desc, doc, depth, bare, namedAs);
        case "array":
            return renderArray(node as any, desc, doc, depth);
        case "record":
            return renderRecord(node as any, doc, depth);
        case "union":
            return renderUnion(node as any, doc, depth);
        case "discriminated":
            return renderDiscriminated(node as any, doc, depth);
        case "tuple":
            return renderTuple(node as any, doc, depth);
        default:
            return renderType(desc, doc);
    }
}

// ── Object: { field: type, ... } ───────────────────────────────────────

function renderObject(
    node: { kind: "object"; properties: Record<string, JsonSchemaDescription>; required: string[] },
    desc: JsonSchemaDescription,
    doc: ApiDocsDocument,
    depth: number,
    bare: boolean,
    namedAs?: string,
): React.ReactNode {
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    const entries = Object.entries(node.properties);

    if (entries.length === 0) {
        return <><span className="text-gray-700">{"{}"}</span></>;
    }

    return (
        <>
            {!bare && namedAs && <span className="text-purple-600">{namedAs}</span>}
            {!bare && namedAs && " "}
            {!bare && <span className="text-gray-700">{"{"}</span>}
            {!bare && "\n"}
            {entries.map(([name, propDesc], i) => {
                const required = node.required.includes(name);
                return (
                    <span key={name}>
                        {indent}
                        <span className="text-blue-700">{name}</span>
                        {!required && <span className="text-gray-400">?</span>}
                        <span className="text-gray-500">: </span>
                        {renderInline(propDesc, doc, depth + 1)}
                        {i < entries.length - 1 ? <span className="text-gray-500">,</span> : null}
                        {renderTrailingComment(propDesc)}
                        {"\n"}
                    </span>
                );
            })}
            {!bare && closeIndent}
            {!bare && <span className="text-gray-700">{"}"}</span>}
        </>
    );
}

// ── Array: T[] (or expanded for complex item types) ──────────────────

function renderArray(
    node: { kind: "array"; element: JsonSchemaDescription; minItems?: number; maxItems?: number },
    desc: JsonSchemaDescription,
    doc: ApiDocsDocument,
    depth: number,
): React.ReactNode {
    const elementIsScalar = isScalar(node.element);
    const sizePill = (node.minItems !== undefined || node.maxItems !== undefined)
        ? <Pill>{describeSize(node.minItems, node.maxItems)}</Pill>
        : null;

    if (elementIsScalar) {
        return (
            <>
                {renderInline(node.element, doc, depth)}
                <span className="text-gray-500">[]</span>
                {sizePill && <> {sizePill}</>}
            </>
        );
    }
    // Complex element — render expanded
    return (
        <>
            <span className="text-gray-700">Array&lt;</span>
            {renderInline(node.element, doc, depth)}
            <span className="text-gray-700">&gt;</span>
            {sizePill && <> {sizePill}</>}
        </>
    );
}

// ── Record: Record<string, V> ──────────────────────────────────────────

function renderRecord(
    node: { kind: "record"; value: JsonSchemaDescription },
    doc: ApiDocsDocument,
    depth: number,
): React.ReactNode {
    return (
        <>
            <span className="text-gray-700">Record&lt;string, </span>
            {renderInline(node.value, doc, depth)}
            <span className="text-gray-700">&gt;</span>
        </>
    );
}

// ── Union: A | B | C ───────────────────────────────────────────────────

function renderUnion(
    node: { kind: "union"; variants: JsonSchemaDescription[] },
    doc: ApiDocsDocument,
    depth: number,
): React.ReactNode {
    return (
        <>
            {node.variants.map((v, i) => (
                <span key={i}>
                    {i > 0 && <span className="text-gray-500"> | </span>}
                    {renderInline(v, doc, depth)}
                </span>
            ))}
        </>
    );
}

// ── Discriminated union — render compactly with discriminator label ────

function renderDiscriminated(
    node: { kind: "discriminated"; discriminator: string; variants: JsonSchemaDescription[] },
    doc: ApiDocsDocument,
    depth: number,
): React.ReactNode {
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    return (
        <>
            <span className="text-gray-500">{`/* discriminated by `}</span>
            <span className="text-purple-600">{node.discriminator}</span>
            <span className="text-gray-500">{` */`}</span>
            {"\n"}
            {node.variants.map((v, i) => {
                const props = (v.node as any).properties;
                const dval = props?.[node.discriminator]?.node?.values?.[0];
                return (
                    <span key={i}>
                        {indent}
                        <span className="text-gray-500">| </span>
                        {dval !== undefined && (
                            <>
                                <span className="text-emerald-700">{JSON.stringify(dval)}</span>
                                <span className="text-gray-500"> ⇒ </span>
                            </>
                        )}
                        {renderInline(v, doc, depth + 1)}
                        {"\n"}
                    </span>
                );
            })}
            {closeIndent}
        </>
    );
}

// ── Tuple: [A, B, C] ───────────────────────────────────────────────────

function renderTuple(
    node: { kind: "tuple"; elements: JsonSchemaDescription[] },
    doc: ApiDocsDocument,
    depth: number,
): React.ReactNode {
    return (
        <>
            <span className="text-gray-500">[</span>
            {node.elements.map((el, i) => (
                <span key={i}>
                    {i > 0 && <span className="text-gray-500">, </span>}
                    {renderInline(el, doc, depth)}
                </span>
            ))}
            <span className="text-gray-500">]</span>
        </>
    );
}

// ── Inline type rendering for property values ──────────────────────────

/** Render a schema as a single-line value (used as the right side of `field: ...`). */
function renderInline(desc: JsonSchemaDescription, doc: ApiDocsDocument, depth: number): React.ReactNode {
    const node = desc.node;

    // Brand types — render the brand name
    if (isPrimitive(node.kind) && desc.docs?.title) {
        return (
            <>
                <span className="text-purple-600">{desc.docs.title.replace(/\s+/g, "")}</span>
                {desc.nullable && <span className="text-gray-500"> | null</span>}
                {desc.defaultValue !== undefined && <DefaultValue value={desc.defaultValue} />}
            </>
        );
    }

    switch (node.kind) {
        case "string":
        case "number":
        case "boolean":
        case "bit":
        case "any":
        case "unknown":
        case "file":
        case "password":
            return (
                <>
                    <span className="text-emerald-700">{primitiveTypeLabel(desc)}</span>
                    {desc.nullable && <span className="text-gray-500"> | null</span>}
                    {desc.defaultValue !== undefined && <DefaultValue value={desc.defaultValue} />}
                </>
            );

        case "literal": {
            const values = (node as any).values as readonly any[];
            return (
                <>
                    {values.map((v, i) => (
                        <span key={i}>
                            {i > 0 && <span className="text-gray-500"> | </span>}
                            <span className="text-emerald-700">{JSON.stringify(v)}</span>
                        </span>
                    ))}
                    {desc.nullable && <span className="text-gray-500"> | null</span>}
                </>
            );
        }

        case "array":
            return renderArray(node as any, desc, doc, depth);

        case "object":
            // Inline nested object — recurse to render multi-line
            return renderObject(node as any, desc, doc, depth, false);

        case "record":
            return renderRecord(node as any, doc, depth);

        case "union":
            return renderUnion(node as any, doc, depth);

        case "discriminated":
            return renderDiscriminated(node as any, doc, depth);

        case "tuple":
            return renderTuple(node as any, doc, depth);

        default:
            return <span className="text-red-500">{(node as any).kind}</span>;
    }
}

function renderType(desc: JsonSchemaDescription, doc: ApiDocsDocument): React.ReactNode {
    return renderInline(desc, doc, 0);
}

function DefaultValue({value}: {value: unknown}) {
    return (
        <>
            <span className="text-gray-500"> = </span>
            <span className="text-emerald-700">{JSON.stringify(value)}</span>
        </>
    );
}

// ── Trailing-comment annotations (constraints / description / example) ─

function renderTrailingComment(desc: JsonSchemaDescription): React.ReactNode {
    const parts: string[] = [];

    const constraints = primitiveConstraints(desc);
    if (constraints.length > 0) parts.push(constraints.join(", "));

    if (desc.docs?.description) parts.push(desc.docs.description);
    if (desc.docs?.example !== undefined) parts.push(`e.g. ${JSON.stringify(desc.docs.example)}`);

    if (parts.length === 0) return null;
    return <span className="text-gray-400 italic">  {`// ${parts.join(" — ")}`}</span>;
}

function Pill({children}: {children: React.ReactNode}) {
    return <span className="text-[10px] font-mono px-1 py-0 rounded bg-gray-200 text-gray-600 ml-1 align-middle">{children}</span>;
}

// ── Helpers ────────────────────────────────────────────────────────────

function isPrimitive(kind: string): boolean {
    return ["string", "number", "boolean", "bit", "literal", "any", "unknown", "file", "password"].includes(kind);
}

function isScalar(desc: JsonSchemaDescription): boolean {
    const k = desc.node.kind;
    return k !== "object" && k !== "discriminated";
}

function primitiveTypeLabel(desc: JsonSchemaDescription): string {
    const node = desc.node;
    switch (node.kind) {
        case "string":   return desc.docs?.format ? `string<${desc.docs.format}>` : "string";
        case "number":   return (node as any).integer ? "integer" : "number";
        case "boolean":  return "boolean";
        case "bit":      return "0|1";
        case "any":      return "any";
        case "unknown":  return "unknown";
        case "file":     return "File";
        case "password": return "Password";
        default:         return node.kind;
    }
}

function primitiveConstraints(desc: JsonSchemaDescription): string[] {
    const node = desc.node;
    const out: string[] = [];
    if (node.kind === "string") {
        if (node.minLength !== undefined && node.maxLength !== undefined) out.push(`${node.minLength}–${node.maxLength} chars`);
        else if (node.minLength !== undefined) out.push(`min ${node.minLength} chars`);
        else if (node.maxLength !== undefined) out.push(`max ${node.maxLength} chars`);
        if (node.pattern) out.push(`pattern: ${node.pattern}`);
    } else if (node.kind === "number") {
        if (node.min !== undefined && node.max !== undefined) out.push(`${node.min}–${node.max}`);
        else if (node.min !== undefined) out.push(`≥ ${node.min}`);
        else if (node.max !== undefined) out.push(`≤ ${node.max}`);
        if (node.multipleOf !== undefined) out.push(`× ${node.multipleOf}`);
    } else if (node.kind === "array") {
        if (node.minItems !== undefined || node.maxItems !== undefined) out.push(describeSize(node.minItems, node.maxItems));
    } else if (node.kind === "password") {
        out.push(`${node.minLength}–${node.maxLength} chars`);
    } else if (node.kind === "file") {
        if (node.maxSize !== undefined) out.push(`≤ ${formatBytes(node.maxSize)}`);
        if (node.accept && node.accept.length > 0) out.push(`accepts ${node.accept.join(", ")}`);
    }
    return out;
}

function describeSize(min?: number, max?: number): string {
    if (min !== undefined && max !== undefined) return `${min}–${max} items`;
    if (min !== undefined) return `min ${min} items`;
    if (max !== undefined) return `max ${max} items`;
    return "";
}

function formatBytes(n: number): string {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}
