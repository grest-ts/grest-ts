import type {MethodDoc} from "../docTypes";

/**
 * Pattern badge: `req` (round-trip) vs `event` (one-way notification).
 *
 * - HTTP: nothing rendered — the verb badge already tells you it's a request.
 * - WS request/response or server-initiated-request → `req`
 * - WS fire-and-forget or server-push → `event`
 *
 * Same component used in the sidebar AND the method header so the visual
 * vocabulary stays uniform.
 */
export function PatternBadge({method, size}: {method: MethodDoc; size?: "xs" | "sm"}) {
    if (method.httpMethod) return null;

    const isEvent = method.wsPattern === "fire-and-forget" || method.wsPattern === "server-push";
    const padding = size === "sm" ? "px-1.5 py-0.5" : "px-1";
    const text    = size === "sm" ? "text-[10px]"    : "text-[9px]";

    if (method.wsByteStream) {
        return (
            <span className={`${text} font-semibold uppercase tracking-wider text-violet-700 bg-violet-50 ${padding} rounded`}>
                bytes
            </span>
        );
    }
    if (isEvent) {
        return (
            <span className={`${text} font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 ${padding} rounded`}>
                event
            </span>
        );
    }
    return (
        <span className={`${text} font-semibold uppercase tracking-wider text-slate-500 bg-slate-100 ${padding} rounded`}>
            req
        </span>
    );
}

/**
 * Leading fixed-width badge: HTTP verb, WS direction (`OUT`/`IN`), or `RAW`
 * for byte-stream sockets (which have no direction). Shared by the sidebar tree
 * and the reuse popover.
 */
export function ActionBadge({method}: {method: MethodDoc}) {
    if (method.httpMethod) {
        const colors: Record<string, string> = {
            GET: "text-blue-600",
            POST: "text-green-600",
            PUT: "text-amber-600",
            PATCH: "text-amber-600",
            DELETE: "text-red-600",
        };
        return (
            <span className={`text-[10px] font-bold w-12 inline-block ${colors[method.httpMethod] ?? "text-gray-500"}`}>
                {method.httpMethod}
            </span>
        );
    }
    if (method.wsByteStream) {
        return <span className="w-12 inline-block text-[10px] font-bold text-violet-600">RAW</span>;
    }
    if (method.wsDirection === "client-to-server") {
        return <span className="w-12 inline-block text-[10px] font-bold text-orange-600">OUT</span>;
    }
    if (method.wsDirection === "server-to-client") {
        return <span className="w-12 inline-block text-[10px] font-bold text-indigo-600">IN</span>;
    }
    return <span className="w-12 inline-block" />;
}
