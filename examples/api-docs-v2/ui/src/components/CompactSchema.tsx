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
    return renderUnionLike(
        node.variants.map(v => renderInline(v, doc, depth + 1)),
        depth,
        false,
    );
}

/**
 * Shared renderer for union/literal alternatives. Inline if ≤3 alternatives,
 * one-per-line with leading `|` if more — easier to scan when the set gets
 * long (e.g. an enum of 10 categories).
 */
function renderUnionLike(
    parts: React.ReactNode[],
    depth: number,
    nullable: boolean,
): React.ReactNode {
    const all = nullable ? [...parts, <span className="text-emerald-700">null</span>] : parts;
    if (all.length <= 3) {
        return (
            <>
                {all.map((p, i) => (
                    <span key={i}>
                        {i > 0 && <span className="text-gray-500"> | </span>}
                        {p}
                    </span>
                ))}
            </>
        );
    }
    const indent = "  ".repeat(depth + 1);
    return (
        <>
            {all.map((p, i) => (
                <span key={i}>
                    {"\n"}
                    {indent}
                    <span className="text-gray-500">| </span>
                    {p}
                </span>
            ))}
        </>
    );
}

// ── Discriminated union — render compactly with discriminator label ────

/**
 * Discriminated union — render as a TypeScript-style intersection of object
 * literals separated by `|`. Each variant is fully expanded so the reader
 * sees its complete shape (including the discriminator field) inline.
 *
 *   /* discriminated by status *​/
 *   {
 *     status: "online",
 *     userId: string,
 *     ...
 *   } | {
 *     status: "offline",
 *     ...
 *   }
 */
function renderDiscriminated(
    node: { kind: "discriminated"; discriminator: string; variants: JsonSchemaDescription[] },
    doc: ApiDocsDocument,
    depth: number,
): React.ReactNode {
    return (
        <>
            <span className="text-gray-500">{`/* discriminated by `}</span>
            <span className="text-purple-600">{node.discriminator}</span>
            <span className="text-gray-500">{` */`}</span>
            {"\n"}
            {"  ".repeat(depth)}
            {node.variants.map((v, i) => (
                <span key={i}>
                    {i > 0 && <span className="text-gray-500"> | </span>}
                    {renderInline(v, doc, depth)}
                </span>
            ))}
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

    // Brand types — render `BaseType & BrandName` (TS-style intersection),
    // so the underlying primitive isn't hidden behind the brand label.
    // Drop the `<format>` suffix when a brand name exists — the brand name
    // already conveys the semantic role, so e.g. `string<email> & EmailAddress`
    // is just duplication.
    //
    // `docs.brand` is the canonical brand identifier (auto-populated by
    // `.brand("UserId")` in @grest-ts/schema). `docs.title` is the human label
    // ("User ID"); fall back to a stripped-whitespace title for legacy schemas
    // that set title but not brand.
    const brandName = brandIdentifier(desc);
    if (isPrimitive(node.kind) && brandName) {
        return (
            <>
                <span className="text-emerald-700">{bareTypeLabel(desc)}</span>
                <span className="text-gray-500"> & </span>
                <span className="text-purple-600">{brandName}</span>
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
            const renderVal = (v: unknown) => <span className="text-emerald-700">{JSON.stringify(v)}</span>;
            return renderUnionLike(values.map(renderVal), depth, desc.nullable);
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

/**
 * Trailing comment after a property: a row of colored "tag" chips for the
 * concise factual hints (title / constraints / example / format) plus the
 * human description as plain prose at the end. Color-coded so the eye can
 * triage what kind of metadata each chip is at a glance.
 */
function renderTrailingComment(desc: JsonSchemaDescription): React.ReactNode {
    const tags: React.ReactNode[] = [];

    // Tag prefixes (`title:`, `e.g.`, `html format:`) are dropped — the chip
    // colors carry the role distinction (indigo=title, emerald=example,
    // amber=html-format-hint, slate=constraints), so the prefix words are
    // visual noise.
    //
    // Order: example → title → format → description (per user preference),
    // with constraints right after example since both are value-level facts.
    if (desc.docs?.example !== undefined) {
        tags.push(<TagChip key="e" tone="emerald">{JSON.stringify(desc.docs.example)}</TagChip>);
    }

    const constraints = primitiveConstraints(desc);
    if (constraints.length > 0) {
        tags.push(<TagChip key="c" tone="slate">{constraints.join(", ")}</TagChip>);
    }

    if (desc.docs?.title) {
        tags.push(<TagChip key="t" tone="indigo">{desc.docs.title}</TagChip>);
    }

    // Format hint — maps onto HTML <input type="..."> conventions.
    if (desc.docs?.format) {
        tags.push(<TagChip key="f" tone="amber">{desc.docs.format}</TagChip>);
    }

    const hasDescription = !!desc.docs?.description;
    if (tags.length === 0 && !hasDescription) return null;

    return (
        <span className="ml-2 inline-flex items-center gap-1 align-middle">
            <span className="text-gray-300 font-mono">//</span>
            {tags}
            {hasDescription && (
                <span className="text-gray-500 italic ml-0.5">{desc.docs!.description}</span>
            )}
        </span>
    );
}

const TONE_CLASSES = {
    slate:   "bg-slate-100 text-slate-600",
    indigo:  "bg-indigo-50 text-indigo-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber:   "bg-amber-50 text-amber-700",
} as const;

function TagChip({tone, children}: {tone: keyof typeof TONE_CLASSES; children: React.ReactNode}) {
    return (
        <span className={`text-[10px] font-mono not-italic px-1.5 py-0 rounded ${TONE_CLASSES[tone]}`}>
            {children}
        </span>
    );
}

function Pill({children}: {children: React.ReactNode}) {
    return <span className="text-[10px] font-mono px-1 py-0 rounded bg-gray-200 text-gray-600 ml-1 align-middle">{children}</span>;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Brand identifier for display. Prefers the explicit `docs.brand` field
 * (auto-populated by grest-ts `.brand("UserId")`), falls back to a
 * whitespace-stripped `docs.title` for older schemas that haven't migrated.
 */
function brandIdentifier(desc: JsonSchemaDescription): string | undefined {
    if (desc.docs?.brand) return desc.docs.brand;
    if (desc.docs?.title) return desc.docs.title.replace(/\s+/g, "");
    return undefined;
}

function isPrimitive(kind: string): boolean {
    return ["string", "number", "boolean", "bit", "literal", "any", "unknown", "file", "password"].includes(kind);
}

/**
 * "Scalar" here means: rendering this inline as `T[]` is unambiguous.
 * Anything that produces a `|` in its rendering (union, multi-value literal,
 * nullable) needs `Array<T>` instead — otherwise the trailing `[]` looks
 * like it only applies to the last alternative (`"a" | "b" | "c"[]`).
 */
function isScalar(desc: JsonSchemaDescription): boolean {
    if (desc.nullable) return false;
    const k = desc.node.kind;
    if (k === "object" || k === "discriminated" || k === "union") return false;
    if (k === "literal" && (desc.node as any).values.length > 1) return false;
    return true;
}

/** Type label *with* the format hint suffix — used when there's no brand name. */
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

/** Type label *without* the format hint — used alongside a brand name where
 *  format would just duplicate what the brand already says. */
function bareTypeLabel(desc: JsonSchemaDescription): string {
    const node = desc.node;
    switch (node.kind) {
        case "string":   return "string";
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
