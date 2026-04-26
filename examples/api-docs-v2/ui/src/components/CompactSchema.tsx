/**
 * CompactSchema — renders any JsonSchemaDescription as a TypeScript-like
 * compact form inside a code block. One line per simple field; multi-line
 * only for nested composites. Types are syntax-colored, brands clickable,
 * constraints as inline pill-comments.
 *
 * Two cross-cutting features come from the `RenderCtx` threaded through
 * every helper:
 *
 *   - `hl` (highlightBrand) — when set, every appearance of that brand is
 *     rendered with a yellow accent, and the row holding the branded leaf
 *     gets a soft yellow background.
 *
 *   - `usageIndex` — when set, every named/branded/composite schema with
 *     >1 method using it (by canonicalId) gets a "↔ N" chip with a click
 *     popover listing the other locations.
 */

import type {ApiDocsDocument, JsonSchemaDescription, SchemaRef} from "../docTypes";
import type {UsageIndex} from "../lib/usageIndex";
import {ReusedChip} from "./ReusedChip";

interface Props {
    schemaRef: SchemaRef;
    doc: ApiDocsDocument;
    bare?: boolean;
    /** Type identifier (brand or `__<canonicalId>`) — see matchesType. */
    highlightType?: string;
    usageIndex?: UsageIndex;
    currentContract?: string;
    currentMethod?: string;
}

interface RenderCtx {
    hl?: string;
    usageIndex?: UsageIndex;
    currentContract?: string;
    currentMethod?: string;
}

export function CompactSchema({schemaRef, doc, bare, highlightType, usageIndex, currentContract, currentMethod}: Props) {
    const ctx: RenderCtx = {hl: highlightType, usageIndex, currentContract, currentMethod};
    return (
        <pre className="text-[13px] leading-6 font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
            <code>
                {renderRef(schemaRef, doc, 0, bare ?? false, ctx)}
            </code>
        </pre>
    );
}

/**
 * Type-identifier for the URL/highlight system.
 *
 *   - If the schema has a `docs.brand`, use it (brands are guaranteed-unique
 *     runtime identifiers).
 *   - Otherwise fall back to `__<canonicalId>` (the underscore prefix avoids
 *     collisions with any user-chosen brand).
 *
 * Title is deliberately NOT used for matching — it's a human label, not an
 * identifier, and may not be unique across schemas.
 */
function typeIdFor(desc: JsonSchemaDescription): string {
    return desc.docs?.brand ?? `__${desc.canonicalId}`;
}

/** Match a schema against a `?type=X` highlight value. */
function matchesType(desc: JsonSchemaDescription, hl: string | undefined): boolean {
    if (!hl) return false;
    if (hl.startsWith("__")) return `__${desc.canonicalId}` === hl;
    return desc.docs?.brand === hl;
}

/**
 * Build the chip JSX for a given schema, or null if not reused.
 * Includes the current method in the popover (full picture, not just "elsewhere").
 * When the schema is the active highlight target, the chip itself takes a
 * yellow accent so anonymous objects without a name are still visually marked.
 */
function reuseChipFor(desc: JsonSchemaDescription, ctx: RenderCtx): React.ReactNode {
    if (!ctx.usageIndex) return null;
    const usages = ctx.usageIndex.get(desc.canonicalId);
    if (!usages || usages.length < 2) return null;
    return (
        <ReusedChip
            refs={usages}
            highlightType={typeIdFor(desc)}
            highlighted={matchesType(desc, ctx.hl)}
        />
    );
}

// ── Recursive rendering ────────────────────────────────────────────────

function renderRef(ref: SchemaRef, doc: ApiDocsDocument, depth: number, bare: boolean, ctx: RenderCtx): React.ReactNode {
    if ("ref" in ref) {
        const named = doc.schemas[ref.ref];
        if (!named) return <span className="text-red-500">unknown:{ref.ref}</span>;
        return renderDesc(named.schema, doc, depth, bare, ref.ref, ctx);
    }
    return renderDesc(ref.inline, doc, depth, bare, undefined, ctx);
}

function renderDesc(
    desc: JsonSchemaDescription,
    doc: ApiDocsDocument,
    depth: number,
    bare: boolean,
    namedAs: string | undefined,
    ctx: RenderCtx,
): React.ReactNode {
    const node = desc.node;
    switch (node.kind) {
        case "object":         return renderObject(node as any, desc, doc, depth, bare, namedAs, ctx);
        case "array":          return renderArray(node as any, desc, doc, depth, ctx);
        case "record":         return renderRecord(node as any, doc, depth, ctx);
        case "union":          return renderUnion(node as any, doc, depth, ctx);
        case "discriminated":  return renderDiscriminated(node as any, doc, depth, ctx);
        case "tuple":          return renderTuple(node as any, doc, depth, ctx);
        default:               return renderType(desc, doc, ctx);
    }
}

// ── Object: { field: type, ... } ───────────────────────────────────────

function renderObject(
    node: { kind: "object"; properties: Record<string, JsonSchemaDescription>; required: string[] },
    desc: JsonSchemaDescription,
    doc: ApiDocsDocument,
    depth: number,
    bare: boolean,
    namedAs: string | undefined,
    ctx: RenderCtx,
): React.ReactNode {
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    const entries = Object.entries(node.properties);

    if (entries.length === 0) {
        return <><span className="text-gray-700">{"{}"}</span></>;
    }

    // Reuse chip — render whenever this object's canonicalId is reused
    // elsewhere, named or not. For named refs the chip sits next to the
    // type name (`User ↔ 3 {`); for anonymous reused objects it sits right
    // after the opening brace (`{  ↔ 3`) so prepareCreate ↔ finalizeCreate
    // style symmetry is visible without the schema needing a title.
    const chip = !bare ? reuseChipFor(desc, ctx) : null;

    // When this object itself is the highlight target, the entire `{...}`
    // block (braces + every property + nested children) gets a yellow tint,
    // so the reader sees the whole subtree as "the highlighted type" — a
    // composite type's value isn't a single token like a brand, it's a
    // structure, so the highlight has to be structural too.
    const selfMatches = !bare && matchesType(desc, ctx.hl);
    const braceClass = selfMatches ? "text-yellow-900 font-semibold" : "text-gray-700";

    const content = (
        <>
            {!bare && namedAs && <span className="text-purple-600">{namedAs}</span>}
            {!bare && namedAs && chip && <>{" "}{chip}</>}
            {!bare && namedAs && " "}
            {!bare && <span className={braceClass}>{"{"}</span>}
            {!bare && !namedAs && chip && <>{" "}{chip}</>}
            {!bare && "\n"}
            {entries.map(([name, propDesc], i) => {
                const required = node.required.includes(name);
                // Row-level highlight: only the row whose value IS the
                // highlighted type. Suppressed when an ancestor is already
                // highlighting (avoid double-yellow).
                const rowMatch = !selfMatches && matchesType(propDesc, ctx.hl);
                const rowClass = rowMatch ? "bg-yellow-100 -mx-1 px-1 rounded" : "";
                return (
                    <span key={name} className={rowClass} {...(rowMatch ? {"data-gg-highlight": ""} : {})}>
                        {indent}
                        <span className="text-blue-700">{name}</span>
                        {!required && <span className="text-gray-400">?</span>}
                        <span className="text-gray-500">: </span>
                        {renderInline(propDesc, doc, depth + 1, ctx)}
                        {i < entries.length - 1 ? <span className="text-gray-500">,</span> : null}
                        {renderTrailingComment(propDesc)}
                        {"\n"}
                    </span>
                );
            })}
            {!bare && closeIndent}
            {!bare && <span className={braceClass}>{"}"}</span>}
        </>
    );

    // Wrap the whole `{...}` block in a yellow background when self matches.
    // `box-decoration-clone` makes the background apply per-line in a <pre>,
    // so the highlight reads as a continuous block instead of patches behind
    // each text run.
    if (selfMatches) {
        return <span data-gg-highlight="" className="bg-yellow-100 rounded box-decoration-clone">{content}</span>;
    }
    return content;
}

// ── Array ──────────────────────────────────────────────────────────────

function renderArray(
    node: { kind: "array"; element: JsonSchemaDescription; minItems?: number; maxItems?: number },
    _desc: JsonSchemaDescription,
    doc: ApiDocsDocument,
    depth: number,
    ctx: RenderCtx,
): React.ReactNode {
    const elementIsScalar = isScalar(node.element);
    const sizePill = (node.minItems !== undefined || node.maxItems !== undefined)
        ? <Pill>{describeSize(node.minItems, node.maxItems)}</Pill>
        : null;

    if (elementIsScalar) {
        return (
            <>
                {renderInline(node.element, doc, depth, ctx)}
                <span className="text-gray-500">[]</span>
                {sizePill && <> {sizePill}</>}
            </>
        );
    }
    return (
        <>
            <span className="text-gray-700">Array&lt;</span>
            {renderInline(node.element, doc, depth, ctx)}
            <span className="text-gray-700">&gt;</span>
            {sizePill && <> {sizePill}</>}
        </>
    );
}

// ── Record ─────────────────────────────────────────────────────────────

function renderRecord(
    node: { kind: "record"; value: JsonSchemaDescription },
    doc: ApiDocsDocument,
    depth: number,
    ctx: RenderCtx,
): React.ReactNode {
    return (
        <>
            <span className="text-gray-700">Record&lt;string, </span>
            {renderInline(node.value, doc, depth, ctx)}
            <span className="text-gray-700">&gt;</span>
        </>
    );
}

// ── Union ──────────────────────────────────────────────────────────────

function renderUnion(
    node: { kind: "union"; variants: JsonSchemaDescription[] },
    doc: ApiDocsDocument,
    depth: number,
    ctx: RenderCtx,
): React.ReactNode {
    return renderUnionLike(
        node.variants.map(v => renderInline(v, doc, depth + 1, ctx)),
        depth,
        false,
    );
}

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

// ── Discriminated union ────────────────────────────────────────────────

function renderDiscriminated(
    node: { kind: "discriminated"; discriminator: string; variants: JsonSchemaDescription[] },
    doc: ApiDocsDocument,
    depth: number,
    ctx: RenderCtx,
): React.ReactNode {
    // Need the parent desc to look up reuse — the discriminator caller passes
    // a node only, not the desc. Reuse rendering for these is added on the
    // closest containing renderObject/renderInline path, so we just emit the
    // structure here.
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
                    {renderInline(v, doc, depth, ctx)}
                </span>
            ))}
        </>
    );
}

// ── Tuple ──────────────────────────────────────────────────────────────

function renderTuple(
    node: { kind: "tuple"; elements: JsonSchemaDescription[] },
    doc: ApiDocsDocument,
    depth: number,
    ctx: RenderCtx,
): React.ReactNode {
    return (
        <>
            <span className="text-gray-500">[</span>
            {node.elements.map((el, i) => (
                <span key={i}>
                    {i > 0 && <span className="text-gray-500">, </span>}
                    {renderInline(el, doc, depth, ctx)}
                </span>
            ))}
            <span className="text-gray-500">]</span>
        </>
    );
}

// ── Inline type rendering for property values ──────────────────────────

function renderInline(desc: JsonSchemaDescription, doc: ApiDocsDocument, depth: number, ctx: RenderCtx): React.ReactNode {
    const node = desc.node;

    const brandName = brandIdentifier(desc);
    if (isPrimitive(node.kind) && brandName) {
        const isHl = matchesType(desc, ctx.hl);
        // Reuse chip lives next to the brand name — the brand IS the
        // semantic identity, so the chip belongs there.
        const chip = reuseChipFor(desc, ctx);
        return (
            <>
                <span className="text-emerald-700">{bareTypeLabel(desc)}</span>
                <span className="text-gray-500"> & </span>
                <span
                    className={`text-purple-600 ${isHl ? "bg-yellow-200 ring-1 ring-yellow-400 px-0.5 rounded font-semibold" : ""}`}
                    {...(isHl ? {"data-gg-highlight": ""} : {})}
                >
                    {brandName}
                </span>
                {chip && <>{" "}{chip}</>}
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
            const enumChip = values.length > 1 ? reuseChipFor(desc, ctx) : null;
            const isHl = matchesType(desc, ctx.hl);
            const wrap = (children: React.ReactNode) => isHl
                ? <span data-gg-highlight="" className="bg-yellow-100 rounded px-0.5 box-decoration-clone">{children}</span>
                : <>{children}</>;
            return wrap(<>
                {renderUnionLike(values.map(renderVal), depth, desc.nullable)}
                {enumChip && <>{" "}{enumChip}</>}
            </>);
        }

        case "array":          return renderArray(node as any, desc, doc, depth, ctx);
        case "object":         return renderObject(node as any, desc, doc, depth, false, undefined, ctx);
        case "record":         return renderRecord(node as any, doc, depth, ctx);
        case "union":          return renderUnion(node as any, doc, depth, ctx);
        case "discriminated":  return renderDiscriminated(node as any, doc, depth, ctx);
        case "tuple":          return renderTuple(node as any, doc, depth, ctx);

        default:
            return <span className="text-red-500">{(node as any).kind}</span>;
    }
}

function renderType(desc: JsonSchemaDescription, doc: ApiDocsDocument, ctx: RenderCtx): React.ReactNode {
    return renderInline(desc, doc, 0, ctx);
}

function DefaultValue({value}: {value: unknown}) {
    return (
        <>
            <span className="text-gray-500"> = </span>
            <span className="text-emerald-700">{JSON.stringify(value)}</span>
        </>
    );
}

// ── Trailing-comment annotations ──────────────────────────────────────

function renderTrailingComment(desc: JsonSchemaDescription): React.ReactNode {
    const tags: React.ReactNode[] = [];

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

function brandIdentifier(desc: JsonSchemaDescription): string | undefined {
    if (desc.docs?.brand) return desc.docs.brand;
    if (desc.docs?.title) return desc.docs.title.replace(/\s+/g, "");
    return undefined;
}

function isPrimitive(kind: string): boolean {
    return ["string", "number", "boolean", "bit", "literal", "any", "unknown", "file", "password"].includes(kind);
}

function isScalar(desc: JsonSchemaDescription): boolean {
    if (desc.nullable) return false;
    const k = desc.node.kind;
    if (k === "object" || k === "discriminated" || k === "union") return false;
    if (k === "literal" && (desc.node as any).values.length > 1) return false;
    return true;
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
