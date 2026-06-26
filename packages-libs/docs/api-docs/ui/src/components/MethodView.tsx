import {useEffect, useRef, useState} from "react";
import type {ApiDocsDocument, ContractDoc, ErrorDoc, MethodDoc, PermissionDoc, PermissionTree, SchemaRef} from "../docTypes";
import {CompactSchema} from "./CompactSchema";
import {ExampleSchema} from "./ExampleSchema";
import {PillToggle} from "./Tabs";
import {PatternBadge} from "./Badges";
import {ERROR_TYPE_PREFIX, type UsageIndex} from "../lib/usageIndex";
import {ReusedChip} from "./ReusedChip";

interface Props {
    contract: ContractDoc;
    method: MethodDoc;
    doc: ApiDocsDocument;
    /** When set, every appearance of this type in the body is highlighted. */
    highlightType?: string;
    /** When provided, drives the "↔ N" reuse chips on schemas in the body. */
    usageIndex?: UsageIndex;
}

export function MethodView({contract, method, doc, highlightType, usageIndex}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);

    /**
     * After the body renders (or re-renders due to a different method/highlight),
     * find the first highlight marker in the DOM and scroll it into view. Helps
     * the reader locate the type they came in to look at without manual scanning.
     */
    useEffect(() => {
        if (!highlightType) return;
        // requestAnimationFrame ensures all child schemas have flushed to DOM.
        const id = requestAnimationFrame(() => {
            const el = containerRef.current?.querySelector("[data-gg-highlight]");
            if (el) el.scrollIntoView({behavior: "smooth", block: "center"});
        });
        return () => cancelAnimationFrame(id);
    }, [highlightType, contract.name, method.name]);

    return (
        <div ref={containerRef} className="max-w-[1800px] px-8 py-8">
            <MethodHeader contract={contract} method={method} />

            {method.description && (
                <p className="text-gray-700 mb-6 leading-relaxed">{method.description}</p>
            )}

            {method.deprecated && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
                    <span className="font-semibold text-amber-900">Deprecated</span>
                    {method.deprecationMessage && (
                        <span className="text-amber-800 ml-2">— {method.deprecationMessage}</span>
                    )}
                </div>
            )}

            <AuthenticationSection contract={contract} method={method} />

            {contract.headers && contract.headers.length > 0 && (
                <Section title="Headers">
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono text-[13px] leading-6">
                        {contract.headers.map(h => (
                            <div key={h.name} className="flex items-baseline gap-2">
                                <span className="text-blue-700">{h.name}</span>
                                {!h.required && <span className="text-gray-400">?</span>}
                                <span className="text-gray-500">:</span>
                                <InlineRef schemaRef={h.schema} doc={doc} highlightType={highlightType} />
                                {h.description && <span className="text-gray-400 italic ml-2">  // {h.description}</span>}
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {contract.cookies && contract.cookies.length > 0 && (
                <Section title="Cookies">
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono text-[13px] leading-6">
                        {contract.cookies.map(c => (
                            <div key={c.name} className="flex items-baseline gap-2">
                                <span className="text-purple-700">Cookie: {c.name}</span>
                                {!c.required && <span className="text-gray-400">?</span>}
                                <span className="text-gray-500">:</span>
                                <InlineRef schemaRef={c.schema} doc={doc} highlightType={highlightType} />
                                {c.description && <span className="text-gray-400 italic ml-2">  // {c.description}</span>}
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* Request — params and body */}
            {(method.pathParams?.length || method.queryParams?.length || method.requestBody || method.wsInput) ? (
                <Section title={requestSectionTitle(method)}>
                    <RequestPane method={method} doc={doc} highlightType={highlightType} usageIndex={usageIndex} contractName={contract.name} />
                </Section>
            ) : null}

            {!isNoReplyWs(method) && <SuccessResponseSection method={method} doc={doc} highlightType={highlightType} usageIndex={usageIndex} contractName={contract.name} />}
            {!isNoReplyWs(method) && <ErrorResponsesSection method={method} doc={doc} highlightType={highlightType} usageIndex={usageIndex} contractName={contract.name} />}
        </div>
    );
}

// ── Request pane ───────────────────────────────────────────────────────

function RequestPane({method, doc, highlightType, usageIndex, contractName}: {
    method: MethodDoc; doc: ApiDocsDocument; highlightType?: string; usageIndex?: UsageIndex; contractName: string;
}) {
    return (
        <div className="space-y-4">
            {method.pathParams && method.pathParams.length > 0 && (
                <ParamGroup label="Path" params={method.pathParams} doc={doc} highlightType={highlightType} />
            )}
            {method.queryParams && method.queryParams.length > 0 && (
                <ParamGroup label="Query" params={method.queryParams} doc={doc} highlightType={highlightType} />
            )}
            {method.requestBody && (
                <SchemaPane label="Body" schemaRef={method.requestBody} doc={doc} highlightType={highlightType} usageIndex={usageIndex} currentContract={contractName} currentMethod={method.name} />
            )}
            {method.wsInput && (
                <SchemaPane
                    label={method.wsByteStream ? "Connect" : method.wsDirection === "client-to-server" ? "Send" : "Receive"}
                    schemaRef={method.wsInput}
                    doc={doc}
                    highlightType={highlightType}
                    usageIndex={usageIndex}
                    currentContract={contractName}
                    currentMethod={method.name}
                />
            )}
        </div>
    );
}

/** Schema pane with Schema/Example toggle. Default = Schema. */
function SchemaPane({label, schemaRef, doc, highlightType, usageIndex, currentContract, currentMethod}: {
    label: string; schemaRef: SchemaRef; doc: ApiDocsDocument;
    highlightType?: string; usageIndex?: UsageIndex; currentContract: string; currentMethod: string;
}) {
    const [view, setView] = useState<"schema" | "example">("schema");
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <Label>{label}</Label>
                <PillToggle
                    options={[{id: "schema", label: "Schema"}, {id: "example", label: "Example"}]}
                    value={view}
                    onChange={setView}
                />
            </div>
            {view === "schema"
                ? <CompactSchema schemaRef={schemaRef} doc={doc} highlightType={highlightType} usageIndex={usageIndex} currentContract={currentContract} currentMethod={currentMethod} />
                : <ExampleSchema schemaRef={schemaRef} doc={doc} highlightType={highlightType} />}
        </div>
    );
}

function ParamGroup({label, params, doc, highlightType}: {label: string; params: NonNullable<MethodDoc["pathParams"]>; doc: ApiDocsDocument; highlightType?: string}) {
    return (
        <div>
            <Label>{label}</Label>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono text-[13px] leading-6">
                {params.map(p => {
                    const matches = highlightType && refContainsBrand(p.schema, highlightType, doc);
                    return (
                        <div key={p.name} className={`flex items-baseline gap-2 ${matches ? "bg-yellow-100 -mx-2 px-2 rounded" : ""}`}>
                            <span className="text-blue-700">{p.name}</span>
                            {!p.required && <span className="text-gray-400">?</span>}
                            <span className="text-gray-500">:</span>
                            <InlineRef schemaRef={p.schema} doc={doc} highlightType={highlightType} />
                            {p.description && <span className="text-gray-400 italic ml-2">  // {p.description}</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** Tiny inline schema renderer for path/query param values — picks up brand or primitive label. */
function InlineRef({schemaRef, doc, highlightType}: {schemaRef: SchemaRef; doc: ApiDocsDocument; highlightType?: string}) {
    if ("ref" in schemaRef) {
        return <span className="text-purple-600">{schemaRef.ref}</span>;
    }
    const desc = schemaRef.inline;
    const brand = desc.docs?.brand ?? (desc.docs?.title && isPrimitiveKind(desc.node.kind) ? desc.docs.title.replace(/\s+/g, "") : undefined);
    if (brand && isPrimitiveKind(desc.node.kind)) {
        const isHighlighted = highlightType === brand;
        return (
            <span className={`text-purple-600 ${isHighlighted ? "bg-yellow-200 ring-1 ring-yellow-400 px-0.5 rounded" : ""}`}>
                {brand}
            </span>
        );
    }
    const node = desc.node;
    switch (node.kind) {
        case "string":   return <span className="text-emerald-700">{desc.docs?.format ? `string<${desc.docs.format}>` : "string"}</span>;
        case "number":   return <span className="text-emerald-700">{(node as any).integer ? "integer" : "number"}</span>;
        case "boolean":  return <span className="text-emerald-700">boolean</span>;
        case "literal":  return <span className="text-emerald-700">{(node as any).values.map((v: any) => JSON.stringify(v)).join(" | ")}</span>;
        default:         return <span className="text-emerald-700">{node.kind}</span>;
    }
}

/** Walk a SchemaRef recursively and return true if it (or anything nested under it) carries the given brand. */
function refContainsBrand(ref: SchemaRef, brand: string, doc: ApiDocsDocument, seen = new Set<string>()): boolean {
    if ("ref" in ref) {
        if (seen.has(ref.ref)) return false;
        seen.add(ref.ref);
        const named = doc.schemas[ref.ref];
        return !!named && descContainsBrand(named.schema, brand, doc, seen);
    }
    return descContainsBrand(ref.inline, brand, doc, seen);
}

function descContainsBrand(desc: import("../docTypes").JsonSchemaDescription, brand: string, doc: ApiDocsDocument, seen: Set<string>): boolean {
    if (desc.docs?.brand === brand) return true;
    const node = desc.node;
    switch (node.kind) {
        case "object":
            return Object.values(node.properties).some(p => descContainsBrand(p, brand, doc, seen));
        case "array":
            return descContainsBrand(node.element, brand, doc, seen);
        case "record":
            return descContainsBrand(node.value, brand, doc, seen);
        case "union":
        case "discriminated":
            return node.variants.some(v => descContainsBrand(v, brand, doc, seen));
        case "tuple":
            return node.elements.some(e => descContainsBrand(e, brand, doc, seen));
    }
    return false;
}

function isPrimitiveKind(k: string): boolean {
    return ["string", "number", "boolean", "bit", "literal", "any", "unknown", "file", "password"].includes(k);
}

// ── Responses (tabbed) ─────────────────────────────────────────────────

function isNoReplyWs(method: MethodDoc): boolean {
    return method.wsPattern === "fire-and-forget" || method.wsPattern === "server-push";
}

function requestSectionTitle(method: MethodDoc): React.ReactNode {
    if (method.wsDirection === "client-to-server") {
        return <span className="text-orange-700">Client sends</span>;
    }
    if (method.wsDirection === "server-to-client") {
        return <span className="text-indigo-700">Server pushes</span>;
    }
    return "Request";
}

function SuccessResponseSection({method, doc, highlightType, usageIndex, contractName}: {
    method: MethodDoc; doc: ApiDocsDocument; highlightType?: string; usageIndex?: UsageIndex; contractName: string;
}) {
    if (method.successResponse) {
        return (
            <Section title="Success response">
                <ResponseCard
                    statusCode={200} typeName="OK"
                    schemaRef={method.successResponse} doc={doc}
                    highlightType={highlightType}
                    usageIndex={usageIndex} currentContract={contractName} currentMethod={method.name}
                />
            </Section>
        );
    }
    if (method.httpMethod) {
        return (
            <Section title="Success response">
                <ResponseCard
                    statusCode={204} typeName="No Content"
                    doc={doc} emptyLabel="No response body."
                    currentContract={contractName} currentMethod={method.name}
                />
            </Section>
        );
    }
    return null;
}

function ErrorResponsesSection({method, doc, highlightType, usageIndex, contractName}: {
    method: MethodDoc; doc: ApiDocsDocument; highlightType?: string; usageIndex?: UsageIndex; contractName: string;
}) {
    const errors = method.errors
        .map(t => doc.errors[t])
        .filter((e): e is ErrorDoc => !!e)
        .sort((a, b) => a.statusCode - b.statusCode);

    if (errors.length === 0) return null;

    return (
        <Section title={`Error responses (${errors.length})`}>
            <div className="space-y-4">
                {errors.map(err => (
                    <ResponseCard
                        key={err.type}
                        statusCode={err.statusCode} typeName={err.type}
                        description={err.description} schemaRef={err.data}
                        doc={doc} emptyLabel="No payload."
                        highlightType={highlightType}
                        usageIndex={usageIndex} currentContract={contractName} currentMethod={method.name}
                        errorType={err.type}
                    />
                ))}
            </div>
        </Section>
    );
}

function ResponseCard({
    statusCode, typeName, description, schemaRef, emptyLabel, doc, highlightType, usageIndex, currentContract, currentMethod, errorType,
}: {
    statusCode: number;
    typeName: string;
    description?: string;
    schemaRef?: SchemaRef;
    emptyLabel?: string;
    doc: ApiDocsDocument;
    highlightType?: string;
    usageIndex?: UsageIndex;
    currentContract: string;
    currentMethod: string;
    /** When set, this card represents a declared error type. Triggers an error-namespace reuse chip + highlight. */
    errorType?: string;
}) {
    const [view, setView] = useState<"schema" | "example">("schema");

    // Error reuse chip: cross-method "this same error is thrown by …".
    const errorKey = errorType ? ERROR_TYPE_PREFIX + errorType : undefined;
    const errorRefs = errorKey && usageIndex ? usageIndex.get(errorKey) : undefined;
    const errorChip = errorRefs && errorRefs.length >= 2
        ? <ReusedChip refs={errorRefs} highlightType={errorKey!} highlighted={highlightType === errorKey} />
        : null;
    const cardHighlighted = errorKey ? highlightType === errorKey : false;

    return (
        <div data-gg-highlight={cardHighlighted ? "" : undefined}
             className={cardHighlighted ? "bg-yellow-50 -mx-2 px-2 py-1 rounded ring-1 ring-yellow-300" : ""}>
            <div className="flex items-center gap-2 mb-2">
                <span className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded ${statusColor(statusCode)}`}>
                    {statusCode}
                </span>
                <code className="text-sm font-mono text-gray-900">{typeName}</code>
                {errorChip}
                {description && <span className="text-xs text-gray-500 truncate">— {description}</span>}
                {schemaRef && (
                    <div className="ml-auto shrink-0">
                        <PillToggle
                            options={[{id: "schema", label: "Schema"}, {id: "example", label: "Example"}]}
                            value={view}
                            onChange={setView}
                        />
                    </div>
                )}
            </div>
            {schemaRef ? (
                view === "schema"
                    ? <CompactSchema schemaRef={schemaRef} doc={doc} highlightType={highlightType} usageIndex={usageIndex} currentContract={currentContract} currentMethod={currentMethod} />
                    : <ExampleSchema schemaRef={schemaRef} doc={doc} highlightType={highlightType} />
            ) : (
                <div className="text-sm text-gray-500 italic px-1">{emptyLabel ?? "—"}</div>
            )}
        </div>
    );
}

function statusColor(code: number): string {
    if (code >= 500) return "bg-red-100 text-red-700";
    if (code >= 400) return "bg-orange-100 text-orange-700";
    if (code >= 300) return "bg-amber-100 text-amber-700";
    if (code >= 200) return "bg-emerald-100 text-emerald-700";
    return "bg-gray-100 text-gray-700";
}

// ── Header ─────────────────────────────────────────────────────────────

function MethodHeader({contract, method}: {contract: ContractDoc; method: MethodDoc}) {
    if (contract.kind === "http") {
        const fullPath = (contract.pathPrefix ?? "").replace(/\/$/, "") + (method.httpPath ?? "");
        return (
            <div className="mb-6">
                <div className="flex items-center gap-3 text-sm text-gray-500 mb-2">
                    <span>{contract.name}</span>
                    <span>›</span>
                    <span>{method.summary ?? method.name}</span>
                </div>
                <div className="flex items-center gap-3 mb-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${methodColor(method.httpMethod)}`}>
                        {method.httpMethod}
                    </span>
                    <code className="text-lg font-mono text-gray-800">{fullPath}</code>
                </div>
                <h1 className="text-2xl font-bold">{method.summary ?? method.name}</h1>
            </div>
        );
    }
    // WS — direction shown via colored 3-segment chip; pattern (req/event)
    // shown via the same shared PatternBadge as the sidebar.
    return (
        <div className="mb-6">
            <div className="flex items-center gap-3 text-sm text-gray-500 mb-2">
                <span>{contract.name}</span>
                <span>›</span>
                <span>{method.summary ?? method.name}</span>
            </div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
                {method.wsByteStream
                    ? <ByteStreamChip customClient={method.wsByteStream.customClient} />
                    : <DirectionChip direction={method.wsDirection ?? "client-to-server"} />}
                <code className="text-lg font-mono text-gray-800">{contract.path}</code>
                {!method.wsByteStream && <PatternBadge method={method} size="sm" />}
            </div>
            <h1 className="text-2xl font-bold">{method.summary ?? method.name}</h1>
            {/* Plain-language helper — removes any guesswork about who sends what.
                Raw sockets carry their own prose in method.description, shown above. */}
            {!method.wsByteStream && (
                <p className="text-sm text-gray-500 mt-2">
                    {directionExplainer(method.wsDirection, method.wsPattern)}
                </p>
            )}
        </div>
    );
}

// No direction segment: a raw socket is an opaque bidirectional wire, not client→server or server→client.
function ByteStreamChip({customClient}: {customClient: boolean}) {
    return (
        <div className="inline-flex items-stretch text-xs font-semibold rounded-md overflow-hidden border border-violet-300 shadow-sm">
            <span className="px-2 py-1 bg-violet-500 text-white uppercase tracking-wider">Byte stream</span>
            {customClient && <span className="px-2 py-1 bg-violet-100 text-violet-900 uppercase tracking-wider">Custom client</span>}
        </div>
    );
}

/**
 * Three-segment direction chip. Same word ("SEND") for both directions —
 * color and actor labels carry the directional meaning.
 *
 *   [ CLIENT ][ SEND ][ SERVER ]   orange   (client pushes to server)
 *   [ SERVER ][ SEND ][ CLIENT ]   indigo   (server pushes to client)
 */
function DirectionChip({direction}: {direction: "client-to-server" | "server-to-client"}) {
    if (direction === "client-to-server") {
        return (
            <div className="inline-flex items-stretch text-xs font-semibold rounded-md overflow-hidden border border-orange-300 shadow-sm">
                <span className="px-2 py-1 bg-orange-100 text-orange-900 uppercase tracking-wider">Client</span>
                <span className="px-2 py-1 bg-orange-500 text-white">SENDS TO</span>
                <span className="px-2 py-1 bg-orange-100 text-orange-900 uppercase tracking-wider">Server</span>
            </div>
        );
    }
    return (
        <div className="inline-flex items-stretch text-xs font-semibold rounded-md overflow-hidden border border-indigo-300 shadow-sm">
            <span className="px-2 py-1 bg-indigo-100 text-indigo-900 uppercase tracking-wider">Server</span>
            <span className="px-2 py-1 bg-indigo-500 text-white">SENDS TO</span>
            <span className="px-2 py-1 bg-indigo-100 text-indigo-900 uppercase tracking-wider">Client</span>
        </div>
    );
}

function directionExplainer(direction?: "client-to-server" | "server-to-client", pattern?: MethodDoc["wsPattern"]): string {
    if (direction === "client-to-server") {
        if (pattern === "request-response") return "The client sends this message to the server and waits for a reply.";
        return "The client sends this message to the server. No reply.";
    }
    if (direction === "server-to-client") {
        if (pattern === "server-initiated-request") return "The server pushes this message and expects the client to reply.";
        return "The server pushes this message to the client unprompted.";
    }
    return "";
}

function methodColor(m?: string): string {
    switch (m) {
        case "GET":    return "bg-blue-100 text-blue-700";
        case "POST":   return "bg-green-100 text-green-700";
        case "PUT":    return "bg-amber-100 text-amber-700";
        case "PATCH":  return "bg-amber-100 text-amber-700";
        case "DELETE": return "bg-red-100 text-red-700";
        default:       return "bg-gray-100 text-gray-700";
    }
}

// ── Layout helpers ─────────────────────────────────────────────────────

function Section({title, children}: {title: React.ReactNode; children: React.ReactNode}) {
    return (
        <section className="mb-6">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">{title}</h2>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                {children}
            </div>
        </section>
    );
}

function Label({children}: {children: React.ReactNode}) {
    return <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">{children}</div>;
}

// ── Authentication section ─────────────────────────────────────────────

/**
 * Combined Authentication + Permission block. Renders the auth-scheme
 * rows declared by middleware (Bearer, api-key, …) and — when the
 * contract gates the method on a non-trivial scope — an extra
 * `[SCOPE] permission …` row using the same visual pattern.
 *
 * Hidden entirely when there's no auth middleware AND the permission is
 * `public` or `anyAuth`. The auth pills already imply "must be
 * authenticated"; restating that as a permission row is noise. Only
 * interesting (scope / allOf / anyOf) permissions get rendered.
 *
 * For WS schemas, a non-trivial `connectPermission` adds a separate row
 * — same visual style but labeled "connect" to disambiguate from the
 * per-message gate.
 */
function AuthenticationSection({contract, method}: {contract: ContractDoc; method: MethodDoc}) {
    const authRows = contract.auth ?? [];
    const showMethodPerm = isInterestingPermission(method.permission);
    const showConnectPerm = isInterestingPermission(contract.connectPermission);

    if (authRows.length === 0 && !showMethodPerm && !showConnectPerm) return null;

    return (
        <Section title="Authentication">
            <div className="space-y-1.5">
                {authRows.map(a => (
                    <div key={a.headerName} className="flex items-baseline gap-3 text-sm">
                        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded uppercase ${authSchemePillStyle(a.scheme)}`}>{a.scheme}</span>
                        <code className="text-gray-700 font-mono">{a.headerName}</code>
                        {a.description && <span className="text-gray-500">{a.description}</span>}
                    </div>
                ))}
                {showConnectPerm && (
                    <PermissionRow label="connect" permission={contract.connectPermission!} />
                )}
                {showMethodPerm && (
                    <PermissionRow label="permission" permission={method.permission!} />
                )}
            </div>
        </Section>
    );
}

/** Bearer keeps its dedicated purple pill (RFC 6750, known protocol).
 *  Every other auth header renders gray — visually neutral, no implied
 *  protocol claim beyond "this header is part of the auth surface." */
function authSchemePillStyle(scheme: "bearer" | "header"): string {
    if (scheme === "header") return "bg-slate-100 text-slate-600";
    return "bg-purple-100 text-purple-700";
}

function isInterestingPermission(p?: PermissionDoc): boolean {
    if (!p) return false;
    return p.tree.kind !== "public" && p.tree.kind !== "anyAuth";
}

/** One row inside the Authentication section, styled to match the
 *  `[scheme] header description` row pattern: `[SCOPE] label tree…`. */
function PermissionRow({label, permission}: {label: string; permission: PermissionDoc}) {
    return (
        <div className="flex items-baseline gap-3 text-sm">
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">scope</span>
            <code className="text-gray-700 font-mono">{label}</code>
            <span className="text-gray-700"><PermissionNode tree={permission.tree} /></span>
        </div>
    );
}

function PermissionNode({tree}: {tree: PermissionTree}) {
    switch (tree.kind) {
        case "public":
            // Filtered out at the section level, but render defensively in case
            // a nested combinator child ever takes this shape.
            return <span className="text-gray-500">public</span>;
        case "anyAuth":
            return <span className="text-gray-500">any authenticated identity</span>;
        case "scope":
            return (
                <code className="inline-flex items-center text-[12px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                    {tree.scope}
                </code>
            );
        case "allOf":
            return <Combinator label="and" children={tree.children} />;
        case "anyOf":
            return <Combinator label="or" children={tree.children} />;
    }
}

function Combinator({label, children}: {label: "and" | "or"; children: PermissionTree[]}) {
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
            {children.map((child, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                    {i > 0 && (
                        <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-1">
                            {label}
                        </span>
                    )}
                    {needsParens(child)
                        ? <span className="inline-flex items-center gap-1.5"><span className="text-gray-400">(</span><PermissionNode tree={child} /><span className="text-gray-400">)</span></span>
                        : <PermissionNode tree={child} />}
                </span>
            ))}
        </span>
    );
}

/** A nested combinator gets parenthesised; leaves don't, to keep the
 *  inline rendering readable for the common `anyOf(scope, scope)` case. */
function needsParens(tree: PermissionTree): boolean {
    return tree.kind === "allOf" || tree.kind === "anyOf";
}
