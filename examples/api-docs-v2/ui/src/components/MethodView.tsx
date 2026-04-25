import {useState} from "react";
import type {ApiDocsDocument, ContractDoc, ErrorDoc, MethodDoc, SchemaRef} from "../docTypes";
import {CompactSchema} from "./CompactSchema";
import {ExampleSchema} from "./ExampleSchema";
import {Tabs, PillToggle, type TabDef} from "./Tabs";

interface Props {
    contract: ContractDoc;
    method: MethodDoc;
    doc: ApiDocsDocument;
}

export function MethodView({contract, method, doc}: Props) {
    return (
        <div className="max-w-4xl mx-auto px-8 py-8">
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
                <Section title={method.wsDirection ? (method.wsDirection === "client-to-server" ? "Outgoing message" : "Incoming message") : "Request"}>
                    <RequestPane method={method} doc={doc} />
                </Section>
            ) : null}

            {/* Responses — success + errors as tabs */}
            <Section title="Responses">
                <ResponsesTabs method={method} doc={doc} />
            </Section>
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

/** Schema pane with Example/Schema toggle. Default = Example. */
function SchemaPane({label, schemaRef, doc}: {label: string; schemaRef: SchemaRef; doc: ApiDocsDocument}) {
    const [view, setView] = useState<"example" | "schema">("example");
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <Label>{label}</Label>
                <PillToggle
                    options={[{id: "example", label: "Example"}, {id: "schema", label: "Schema"}]}
                    value={view}
                    onChange={setView}
                />
            </div>
            {view === "example"
                ? <ExampleSchema schemaRef={schemaRef} doc={doc} />
                : <CompactSchema schemaRef={schemaRef} doc={doc} />}
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

function ResponsesTabs({method, doc}: {method: MethodDoc; doc: ApiDocsDocument}) {
    const tabs: TabDef[] = [];
    let defaultId = "200";

    // Success tab — only HTTP/WS request-response patterns have one
    if (method.successResponse) {
        const ref = method.successResponse;
        tabs.push({
            id: "200",
            label: <StatusTab code={200} type="OK" />,
            content: <ResponseBody schemaRef={ref} doc={doc} />,
        });
    } else if (method.wsPattern === "fire-and-forget" || method.wsPattern === "server-push") {
        tabs.push({
            id: "void",
            label: <span className="text-xs px-1">No reply</span>,
            content: <div className="text-sm text-gray-500 italic px-1">No response — this method is {method.wsPattern.replace(/-/g, " ")}.</div>,
        });
        defaultId = "void";
    } else if (method.httpMethod) {
        tabs.push({
            id: "204",
            label: <StatusTab code={204} type="No Content" />,
            content: <div className="text-sm text-gray-500 italic px-1">No response body.</div>,
        });
        defaultId = "204";
    }

    // Error tabs — one per error type, ordered by status code
    const errors = method.errors
        .map(t => doc.errors[t])
        .filter((e): e is ErrorDoc => !!e)
        .sort((a, b) => a.statusCode - b.statusCode);

    for (const err of errors) {
        const errData = err.data;
        tabs.push({
            id: err.type,
            label: <StatusTab code={err.statusCode} type={err.type} variant="error" />,
            content: (
                <div className="space-y-3">
                    <div className="flex items-center gap-3 text-sm">
                        <span className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded ${statusColor(err.statusCode)}`}>
                            {err.statusCode}
                        </span>
                        <code className="font-mono text-gray-900">{err.type}</code>
                        {err.description && <span className="text-gray-500 text-xs">— {err.description}</span>}
                    </div>
                    {errData ? (
                        <ResponseBody schemaRef={errData} doc={doc} />
                    ) : (
                        <div className="text-sm text-gray-500 italic">No payload.</div>
                    )}
                </div>
            ),
        });
    }

    if (tabs.length === 0) {
        return <div className="text-sm text-gray-500 italic">No responses defined.</div>;
    }

    return <Tabs tabs={tabs} defaultId={defaultId} />;
}

/** Response body with Example/Schema toggle. Default = Example. */
function ResponseBody({schemaRef, doc}: {schemaRef: SchemaRef; doc: ApiDocsDocument}) {
    const [view, setView] = useState<"example" | "schema">("example");
    return (
        <div>
            <div className="flex justify-end mb-1.5">
                <PillToggle
                    options={[{id: "example", label: "Example"}, {id: "schema", label: "Schema"}]}
                    value={view}
                    onChange={setView}
                />
            </div>
            {view === "example"
                ? <ExampleSchema schemaRef={schemaRef} doc={doc} />
                : <CompactSchema schemaRef={schemaRef} doc={doc} />}
        </div>
    );
}

function StatusTab({code, type, variant}: {code: number | string; type: string; variant?: "error"}) {
    const color = typeof code === "number" ? statusColor(code) : "bg-emerald-100 text-emerald-700";
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${color}`}>
                {code}
            </span>
            <span className={`text-xs ${variant === "error" ? "text-gray-700" : "font-medium"}`}>{type}</span>
        </span>
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
    // WS
    const arrow = method.wsDirection === "client-to-server" ? "→" : "←";
    const patternLabel = patternToLabel(method.wsPattern);
    return (
        <div className="mb-6">
            <div className="flex items-center gap-3 text-sm text-gray-500 mb-2">
                <span>{contract.name}</span>
                <span>›</span>
                <span>{method.summary ?? method.name}</span>
            </div>
            <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-bold px-2 py-1 rounded bg-purple-100 text-purple-700 uppercase">WS</span>
                <span className="text-purple-600 font-bold">{arrow}</span>
                <code className="text-lg font-mono text-gray-800">{contract.path}</code>
                <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                    {patternLabel}
                </span>
            </div>
            <h1 className="text-2xl font-bold">{method.summary ?? method.name}</h1>
        </div>
    );
}

function patternToLabel(p?: string): string {
    switch (p) {
        case "request-response":         return "Request / Response";
        case "fire-and-forget":          return "Fire-and-forget";
        case "server-push":              return "Server push";
        case "server-initiated-request": return "Server-initiated request";
        default:                          return "";
    }
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

function Section({title, children}: {title: string; children: React.ReactNode}) {
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
