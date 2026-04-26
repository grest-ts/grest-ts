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
