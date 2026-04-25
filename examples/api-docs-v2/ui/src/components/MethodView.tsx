import type {ApiDocsDocument, ContractDoc, MethodDoc} from "../docTypes";
import {SchemaView} from "./SchemaView";

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
                    <div className="space-y-2">
                        {contract.auth.map(a => (
                            <div key={a.headerName} className="flex items-baseline gap-3 text-sm">
                                <span className="font-mono text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">{a.scheme}</span>
                                <code className="text-gray-700 font-mono">{a.headerName}</code>
                                {a.description && <span className="text-gray-500">{a.description}</span>}
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* HTTP-specific input rendering */}
            {method.pathParams && method.pathParams.length > 0 && (
                <Section title="Path Parameters">
                    <ParamList params={method.pathParams} doc={doc} />
                </Section>
            )}
            {method.queryParams && method.queryParams.length > 0 && (
                <Section title="Query Parameters">
                    <ParamList params={method.queryParams} doc={doc} />
                </Section>
            )}
            {method.requestBody && (
                <Section title="Request Body">
                    <SchemaView schemaRef={method.requestBody} doc={doc} />
                </Section>
            )}

            {/* WS-specific input rendering */}
            {method.wsInput && (
                <Section title={method.wsDirection === "client-to-server" ? "Outgoing Message" : "Incoming Message"}>
                    <SchemaView schemaRef={method.wsInput} doc={doc} />
                </Section>
            )}

            {method.successResponse && (
                <Section title={method.wsPattern === "request-response" || method.wsPattern === "server-initiated-request" ? "Reply" : "Response"}>
                    <SchemaView schemaRef={method.successResponse} doc={doc} />
                </Section>
            )}

            {method.errors.length > 0 && (
                <Section title="Errors">
                    <ErrorList errorTypes={method.errors} doc={doc} />
                </Section>
            )}
        </div>
    );
}

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

function ParamList({params, doc}: {params: NonNullable<MethodDoc["pathParams"]>; doc: ApiDocsDocument}) {
    return (
        <div className="space-y-3">
            {params.map(p => (
                <div key={p.name} className="flex items-baseline gap-3">
                    <code className="text-sm font-mono font-semibold text-gray-900 shrink-0 min-w-[8rem]">
                        {p.name}
                        {p.required && <span className="text-red-500 ml-0.5">*</span>}
                    </code>
                    <div className="flex-1">
                        <SchemaView schemaRef={p.schema} doc={doc} compact />
                        {p.description && <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ErrorList({errorTypes, doc}: {errorTypes: string[]; doc: ApiDocsDocument}) {
    return (
        <div className="space-y-2">
            {errorTypes.map(type => {
                const err = doc.errors[type];
                if (!err) return null;
                const statusColor = err.statusCode >= 500
                    ? "bg-red-100 text-red-700"
                    : err.statusCode >= 400
                        ? "bg-orange-100 text-orange-700"
                        : "bg-gray-100 text-gray-700";
                return (
                    <details key={type} className="group">
                        <summary className="flex items-baseline gap-3 cursor-pointer hover:bg-gray-50 -mx-2 px-2 py-1 rounded">
                            <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${statusColor}`}>
                                {err.statusCode}
                            </span>
                            <code className="text-sm font-mono text-gray-900">{err.type}</code>
                            {err.description && <span className="text-xs text-gray-500">— {err.description}</span>}
                        </summary>
                        {err.data && (
                            <div className="mt-2 pl-12">
                                <div className="text-xs text-gray-500 mb-1">Data</div>
                                <SchemaView schemaRef={err.data} doc={doc} />
                            </div>
                        )}
                    </details>
                );
            })}
        </div>
    );
}
