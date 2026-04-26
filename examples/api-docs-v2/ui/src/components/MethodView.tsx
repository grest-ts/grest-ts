import {useState} from "react";
import type {ApiDocsDocument, ContractDoc, ErrorDoc, MethodDoc, SchemaRef} from "../docTypes";
import {CompactSchema} from "./CompactSchema";
import {ExampleSchema} from "./ExampleSchema";
import {PillToggle} from "./Tabs";
import {PatternBadge} from "./Badges";

interface Props {
    contract: ContractDoc;
    method: MethodDoc;
    doc: ApiDocsDocument;
}

export function MethodView({contract, method, doc}: Props) {
    return (
        <div className="max-w-[1800px] px-8 py-8">
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

            {contract.auth && contract.auth.length > 0 && (
                <Section title="Authentication">
                    <div className="space-y-1.5">
                        {contract.auth.map(a => (
                            <div key={a.headerName} className="flex items-baseline gap-3 text-sm">
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">{a.scheme}</span>
                                <code className="text-gray-700 font-mono">{a.headerName}</code>
                                {a.description && <span className="text-gray-500">{a.description}</span>}
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* Request — params and body */}
            {(method.pathParams?.length || method.queryParams?.length || method.requestBody || method.wsInput) ? (
                <Section title={requestSectionTitle(method)}>
                    <RequestPane method={method} doc={doc} />
                </Section>
            ) : null}

            {/* Success and error responses live in separate sections so the
                visual split between "what you get on success" and "what can go
                wrong" is unmistakable. Both sections skipped entirely for WS
                fire-and-forget / server-push (no reply by definition). */}
            {!isNoReplyWs(method) && <SuccessResponseSection method={method} doc={doc} />}
            {!isNoReplyWs(method) && <ErrorResponsesSection method={method} doc={doc} />}
        </div>
    );
}

// ── Request pane ───────────────────────────────────────────────────────

function RequestPane({method, doc}: {method: MethodDoc; doc: ApiDocsDocument}) {
    return (
        <div className="space-y-4">
            {method.pathParams && method.pathParams.length > 0 && (
                <ParamGroup label="Path" params={method.pathParams} doc={doc} />
            )}
            {method.queryParams && method.queryParams.length > 0 && (
                <ParamGroup label="Query" params={method.queryParams} doc={doc} />
            )}
            {method.requestBody && (
                <SchemaPane label="Body" schemaRef={method.requestBody} doc={doc} />
            )}
            {method.wsInput && (
                <SchemaPane
                    label={method.wsDirection === "client-to-server" ? "Send" : "Receive"}
                    schemaRef={method.wsInput}
                    doc={doc}
                />
            )}
        </div>
    );
}

/** Schema pane with Schema/Example toggle. Default = Schema. */
function SchemaPane({label, schemaRef, doc}: {label: string; schemaRef: SchemaRef; doc: ApiDocsDocument}) {
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
                ? <CompactSchema schemaRef={schemaRef} doc={doc} />
                : <ExampleSchema schemaRef={schemaRef} doc={doc} />}
        </div>
    );
}

function ParamGroup({label, params, doc}: {label: string; params: NonNullable<MethodDoc["pathParams"]>; doc: ApiDocsDocument}) {
    return (
        <div>
            <Label>{label}</Label>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 font-mono text-[13px] leading-6">
                {params.map((p, i) => (
                    <div key={p.name} className="flex items-baseline gap-2">
                        <span className="text-blue-700">{p.name}</span>
                        {!p.required && <span className="text-gray-400">?</span>}
                        <span className="text-gray-500">:</span>
                        <InlineRef schemaRef={p.schema} doc={doc} />
                        {p.description && <span className="text-gray-400 italic ml-2">  // {p.description}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Tiny inline schema renderer for path/query param values — picks up brand or primitive label. */
function InlineRef({schemaRef, doc}: {schemaRef: SchemaRef; doc: ApiDocsDocument}) {
    if ("ref" in schemaRef) {
        return <span className="text-purple-600">{schemaRef.ref}</span>;
    }
    const desc = schemaRef.inline;
    if (desc.docs?.title && isPrimitiveKind(desc.node.kind)) {
        return <span className="text-purple-600">{desc.docs.title.replace(/\s+/g, "")}</span>;
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

/** The single 200 OK (or 204 No Content) success response. */
function SuccessResponseSection({method, doc}: {method: MethodDoc; doc: ApiDocsDocument}) {
    if (method.successResponse) {
        return (
            <Section title="Success response">
                <ResponseCard
                    statusCode={200}
                    typeName="OK"
                    schemaRef={method.successResponse}
                    doc={doc}
                />
            </Section>
        );
    }
    if (method.httpMethod) {
        return (
            <Section title="Success response">
                <ResponseCard
                    statusCode={204}
                    typeName="No Content"
                    doc={doc}
                    emptyLabel="No response body."
                />
            </Section>
        );
    }
    return null;
}

/** All 4xx/5xx errors stacked, sorted by status code. Section omitted if none. */
function ErrorResponsesSection({method, doc}: {method: MethodDoc; doc: ApiDocsDocument}) {
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
                        statusCode={err.statusCode}
                        typeName={err.type}
                        description={err.description}
                        schemaRef={err.data}
                        doc={doc}
                        emptyLabel="No payload."
                    />
                ))}
            </div>
        </Section>
    );
}

function ResponseCard({
    statusCode,
    typeName,
    description,
    schemaRef,
    emptyLabel,
    doc,
}: {
    statusCode: number;
    typeName: string;
    description?: string;
    schemaRef?: SchemaRef;
    emptyLabel?: string;
    doc: ApiDocsDocument;
}) {
    // Toggle state lives on the card so the pill can sit on the same line
    // as the status header (toggle right-justified via `ml-auto`).
    const [view, setView] = useState<"schema" | "example">("schema");
    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <span className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded ${statusColor(statusCode)}`}>
                    {statusCode}
                </span>
                <code className="text-sm font-mono text-gray-900">{typeName}</code>
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
                    ? <CompactSchema schemaRef={schemaRef} doc={doc} />
                    : <ExampleSchema schemaRef={schemaRef} doc={doc} />
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
                <DirectionChip direction={method.wsDirection ?? "client-to-server"} />
                <code className="text-lg font-mono text-gray-800">{contract.path}</code>
                <PatternBadge method={method} size="sm" />
            </div>
            <h1 className="text-2xl font-bold">{method.summary ?? method.name}</h1>
            {/* Plain-language helper — removes any guesswork about who sends what */}
            <p className="text-sm text-gray-500 mt-2">
                {directionExplainer(method.wsDirection, method.wsPattern)}
            </p>
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
