import {useState} from "react";
import type {ApiDocsDocument, JsonSchemaDescription, SchemaRef} from "../docTypes";

interface Props {
    schemaRef: SchemaRef;
    doc: ApiDocsDocument;
    compact?: boolean;
}

export function SchemaView({schemaRef, doc, compact}: Props) {
    if ("ref" in schemaRef) {
        const named = doc.schemas[schemaRef.ref];
        if (!named) {
            return <span className="text-red-500 text-sm">Unknown schema ref: {schemaRef.ref}</span>;
        }
        return <NamedSchemaView ref={schemaRef.ref} desc={named.schema} doc={doc} compact={compact} />;
    }
    return <SchemaNode desc={schemaRef.inline} doc={doc} compact={compact} />;
}

function NamedSchemaView({ref, desc, doc, compact}: {ref: string; desc: JsonSchemaDescription; doc: ApiDocsDocument; compact?: boolean}) {
    if (compact) {
        return <BrandPill title={ref} desc={desc} />;
    }
    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded">{ref}</span>
                {desc.docs?.description && <span className="text-xs text-gray-500">{desc.docs.description}</span>}
            </div>
            <SchemaNode desc={desc} doc={doc} hideTitle />
        </div>
    );
}

function BrandPill({title, desc}: {title: string; desc: JsonSchemaDescription}) {
    const typeLabel = primitiveTypeLabel(desc);
    return (
        <span className="inline-flex items-center gap-1 text-sm">
            <span className="text-purple-700 font-medium">{title}</span>
            {typeLabel && <span className="text-xs text-gray-500">({typeLabel})</span>}
            {desc.optional && <span className="text-xs text-gray-400 italic">optional</span>}
            {desc.nullable && <span className="text-xs text-gray-400 italic">nullable</span>}
        </span>
    );
}

interface NodeProps {
    desc: JsonSchemaDescription;
    doc: ApiDocsDocument;
    compact?: boolean;
    hideTitle?: boolean;
}

function SchemaNode({desc, doc, compact, hideTitle}: NodeProps) {
    const node = desc.node;

    // Brand types: a primitive node with docs.title gets a branded display
    const hasBrandTitle: boolean = !hideTitle && Boolean(desc.docs?.title) && isPrimitive(node.kind);

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
            return <PrimitiveView desc={desc} compact={compact} hasBrandTitle={hasBrandTitle} />;

        case "object":
            return <ObjectView desc={desc} doc={doc} compact={compact} />;

        case "array":
            return <ArrayView desc={desc} doc={doc} compact={compact} />;

        case "record":
            return <RecordView desc={desc} doc={doc} />;

        case "union":
            return <UnionView desc={desc} doc={doc} />;

        case "discriminated":
            return <DiscriminatedView desc={desc} doc={doc} />;

        case "tuple":
            return <TupleView desc={desc} doc={doc} />;

        default:
            return <span className="text-red-500 text-sm">Unknown node kind: {(node as any).kind}</span>;
    }
}

// ── Primitive ──────────────────────────────────────────────────────────

function PrimitiveView({desc, compact, hasBrandTitle}: {desc: JsonSchemaDescription; compact?: boolean; hasBrandTitle?: boolean}) {
    const typeLabel = primitiveTypeLabel(desc);
    const constraints = primitiveConstraints(desc);
    const node = desc.node;

    if (compact) {
        return (
            <span className="inline-flex items-center gap-2 text-sm">
                {hasBrandTitle && <span className="text-purple-700 font-medium">{desc.docs!.title}</span>}
                <span className="font-mono text-gray-600 text-[13px]">{typeLabel}</span>
                {constraints.map((c, i) => <ConstraintPill key={i}>{c}</ConstraintPill>)}
                {desc.optional && <span className="text-xs text-gray-400 italic">optional</span>}
                {desc.nullable && <span className="text-xs text-gray-400 italic">nullable</span>}
                {node.kind === "literal" && (
                    <span className="text-xs text-gray-600 font-mono">
                        = {(node as any).values.map((v: any) => JSON.stringify(v)).join(" | ")}
                    </span>
                )}
            </span>
        );
    }

    return (
        <div>
            <div className="flex items-center gap-2 mb-1">
                {hasBrandTitle && <span className="text-purple-700 font-medium text-sm">{desc.docs!.title}</span>}
                <span className="font-mono text-gray-700 text-sm">{typeLabel}</span>
                {constraints.map((c, i) => <ConstraintPill key={i}>{c}</ConstraintPill>)}
                {desc.optional && <span className="text-xs text-gray-400 italic">optional</span>}
                {desc.nullable && <span className="text-xs text-gray-400 italic">nullable</span>}
            </div>
            {node.kind === "literal" && (
                <div className="text-sm font-mono text-gray-600 mb-1">
                    {(node as any).values.map((v: any) => JSON.stringify(v)).join(" | ")}
                </div>
            )}
            {desc.docs?.description && !hasBrandTitle && (
                <div className="text-xs text-gray-500 mt-1">{desc.docs.description}</div>
            )}
            {desc.docs?.example !== undefined && (
                <div className="text-xs text-gray-500 mt-1">
                    Example: <code className="font-mono text-gray-700">{JSON.stringify(desc.docs.example)}</code>
                </div>
            )}
            {desc.defaultValue !== undefined && (
                <div className="text-xs text-gray-500 mt-1">
                    Default: <code className="font-mono text-gray-700">{JSON.stringify(desc.defaultValue)}</code>
                </div>
            )}
        </div>
    );
}

function ConstraintPill({children}: {children: React.ReactNode}) {
    return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{children}</span>;
}

// ── Object ─────────────────────────────────────────────────────────────

function ObjectView({desc, doc, compact}: {desc: JsonSchemaDescription; doc: ApiDocsDocument; compact?: boolean}) {
    const node = desc.node as Extract<JsonSchemaDescription["node"], {kind: "object"}>;
    const [collapsed, setCollapsed] = useState(false);
    if (compact) {
        return (
            <span className="text-xs text-gray-500 italic">
                object ({Object.keys(node.properties).length} field{Object.keys(node.properties).length === 1 ? "" : "s"})
            </span>
        );
    }
    return (
        <div>
            <button
                onClick={() => setCollapsed(c => !c)}
                className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 hover:text-gray-900 transition flex items-center gap-1"
            >
                <span>{collapsed ? "▸" : "▾"}</span>
                <span>Object · {Object.keys(node.properties).length} field{Object.keys(node.properties).length === 1 ? "" : "s"}</span>
                {desc.docs?.title && <span className="ml-2 normal-case tracking-normal text-purple-700">{desc.docs.title}</span>}
            </button>
            {!collapsed && (
                <div className="space-y-3 pl-3 border-l-2 border-gray-100">
                    {Object.entries(node.properties).map(([name, propDesc]) => {
                        const required = node.required.includes(name);
                        return (
                            <div key={name}>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <code className="text-sm font-mono font-semibold text-gray-900">
                                        {name}
                                        {required && <span className="text-red-500 ml-0.5">*</span>}
                                    </code>
                                </div>
                                <div className="ml-2">
                                    <SchemaNode desc={propDesc} doc={doc} compact />
                                </div>
                                {propDesc.docs?.description && (
                                    <div className="text-xs text-gray-500 mt-1 ml-2">{propDesc.docs.description}</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Array ──────────────────────────────────────────────────────────────

function ArrayView({desc, doc, compact}: {desc: JsonSchemaDescription; doc: ApiDocsDocument; compact?: boolean}) {
    const node = desc.node as Extract<JsonSchemaDescription["node"], {kind: "array"}>;
    if (compact) {
        return (
            <span className="inline-flex items-center gap-1 text-sm">
                <span className="font-mono text-gray-600">Array&lt;</span>
                <SchemaNode desc={node.element} doc={doc} compact />
                <span className="font-mono text-gray-600">&gt;</span>
                {node.minItems !== undefined && <ConstraintPill>min: {node.minItems}</ConstraintPill>}
                {node.maxItems !== undefined && <ConstraintPill>max: {node.maxItems}</ConstraintPill>}
            </span>
        );
    }
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center gap-2">
                <span>Array</span>
                {node.minItems !== undefined && <ConstraintPill>min: {node.minItems}</ConstraintPill>}
                {node.maxItems !== undefined && <ConstraintPill>max: {node.maxItems}</ConstraintPill>}
            </div>
            <div className="pl-3 border-l-2 border-gray-100">
                <div className="text-xs text-gray-500 mb-1">Items:</div>
                <SchemaNode desc={node.element} doc={doc} />
            </div>
        </div>
    );
}

// ── Record ─────────────────────────────────────────────────────────────

function RecordView({desc, doc}: {desc: JsonSchemaDescription; doc: ApiDocsDocument}) {
    const node = desc.node as Extract<JsonSchemaDescription["node"], {kind: "record"}>;
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
                Record&lt;string, T&gt;
            </div>
            <div className="pl-3 border-l-2 border-gray-100">
                <div className="text-xs text-gray-500 mb-1">Values:</div>
                <SchemaNode desc={node.value} doc={doc} />
            </div>
        </div>
    );
}

// ── Union ──────────────────────────────────────────────────────────────

function UnionView({desc, doc}: {desc: JsonSchemaDescription; doc: ApiDocsDocument}) {
    const node = desc.node as Extract<JsonSchemaDescription["node"], {kind: "union"}>;
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
                One of {node.variants.length}
            </div>
            <div className="space-y-2">
                {node.variants.map((variant, i) => (
                    <div key={i} className="bg-gray-50 rounded p-3">
                        <div className="text-xs text-gray-500 mb-1">Variant {i + 1}</div>
                        <SchemaNode desc={variant} doc={doc} />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Discriminated ──────────────────────────────────────────────────────

function DiscriminatedView({desc, doc}: {desc: JsonSchemaDescription; doc: ApiDocsDocument}) {
    const node = desc.node as Extract<JsonSchemaDescription["node"], {kind: "discriminated"}>;
    const [active, setActive] = useState(0);
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center gap-2">
                <span>Discriminated union</span>
                <span className="text-gray-400 normal-case tracking-normal">on field</span>
                <code className="font-mono text-purple-700 text-[11px]">{node.discriminator}</code>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
                {node.variants.map((v, i) => {
                    const props = (v.node as any).properties;
                    const discriminatorValue = props?.[node.discriminator]?.node?.values?.[0];
                    return (
                        <button
                            key={i}
                            onClick={() => setActive(i)}
                            className={`text-xs font-mono px-2 py-1 rounded ${
                                active === i
                                    ? "bg-blue-500 text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                        >
                            {discriminatorValue !== undefined ? JSON.stringify(discriminatorValue) : `variant ${i + 1}`}
                        </button>
                    );
                })}
            </div>
            <div className="bg-gray-50 rounded p-3">
                <SchemaNode desc={node.variants[active]} doc={doc} />
            </div>
        </div>
    );
}

// ── Tuple ──────────────────────────────────────────────────────────────

function TupleView({desc, doc}: {desc: JsonSchemaDescription; doc: ApiDocsDocument}) {
    const node = desc.node as Extract<JsonSchemaDescription["node"], {kind: "tuple"}>;
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
                Tuple [{node.elements.length}]
            </div>
            <div className="space-y-2">
                {node.elements.map((el, i) => (
                    <div key={i} className="flex items-baseline gap-3">
                        <code className="text-sm font-mono text-gray-500 shrink-0">[{i}]</code>
                        <div className="flex-1">
                            <SchemaNode desc={el} doc={doc} compact />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Helpers ────────────────────────────────────────────────────────────

function isPrimitive(kind: string): boolean {
    return ["string", "number", "boolean", "bit", "literal", "any", "unknown", "file", "password"].includes(kind);
}

function primitiveTypeLabel(desc: JsonSchemaDescription): string {
    const node = desc.node;
    switch (node.kind) {
        case "string":   return desc.docs?.format ?? "string";
        case "number":   return node.integer ? "integer" : "number";
        case "boolean":  return "boolean";
        case "bit":      return "bit (0|1)";
        case "literal":  return "literal";
        case "any":      return "any";
        case "unknown":  return "unknown";
        case "file":     return "file";
        case "password": return "password";
        default:         return node.kind;
    }
}

function primitiveConstraints(desc: JsonSchemaDescription): string[] {
    const node = desc.node;
    const out: string[] = [];
    if (node.kind === "string") {
        if (node.minLength !== undefined) out.push(`min: ${node.minLength}`);
        if (node.maxLength !== undefined) out.push(`max: ${node.maxLength}`);
        if (node.pattern) out.push(`pattern`);
    } else if (node.kind === "number") {
        if (node.min !== undefined) out.push(`≥ ${node.min}`);
        if (node.max !== undefined) out.push(`≤ ${node.max}`);
        if (node.multipleOf !== undefined) out.push(`× ${node.multipleOf}`);
    } else if (node.kind === "password") {
        out.push(`min: ${node.minLength}`);
        out.push(`max: ${node.maxLength}`);
    } else if (node.kind === "file") {
        if (node.maxSize !== undefined) out.push(`≤ ${formatBytes(node.maxSize)}`);
        if (node.accept && node.accept.length > 0) out.push(`accept: ${node.accept.join(", ")}`);
    }
    return out;
}

function formatBytes(n: number): string {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}
