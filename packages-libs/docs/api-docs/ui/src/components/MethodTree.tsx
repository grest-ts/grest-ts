/**
 * Reusable Group → Contract → Method tree, used by both the sidebar
 * (Brands tab BrandItem expansion) and the schema reuse popover. Same
 * visual vocabulary, no toggle / filter / selection — those concerns
 * stay in the consumer when needed.
 */

import {useMemo} from "react";
import type {ContractDoc, MethodDoc} from "../docTypes";
import type {MethodRef} from "../lib/brandIndex";

interface Props {
    refs: MethodRef[];
    /** When set, navigation links carry `?type=X` to keep highlight alive. */
    highlightType?: string;
    /** Optional click hook — popover uses it to close itself on navigation. */
    onNavigated?: () => void;
    /** Render method rows as <a href> links (default) or as buttons calling onNavigate. */
    onNavigate?: (path: string) => void;
}

export function MethodTree({refs, highlightType, onNavigated, onNavigate}: Props) {
    /** Group → Contract → Methods, preserving doc order. */
    const tree = useMemo(() => {
        const groups = new Map<string, {name: string; contracts: Map<string, {contract: ContractDoc; refs: MethodRef[]}>}>();
        for (const r of refs) {
            let g = groups.get(r.groupSlug);
            if (!g) { g = {name: r.groupName, contracts: new Map()}; groups.set(r.groupSlug, g); }
            let c = g.contracts.get(r.contract.name);
            if (!c) { c = {contract: r.contract, refs: []}; g.contracts.set(r.contract.name, c); }
            c.refs.push(r);
        }
        return [...groups.entries()];
    }, [refs]);

    return (
        <div>
            {tree.map(([slug, g]) => (
                <div key={slug} className="mb-2 last:mb-0">
                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        {g.name}
                        <span className="ml-1.5 text-gray-400 normal-case tracking-normal">
                            {[...g.contracts.values()].reduce((s, c) => s + c.refs.length, 0)}
                        </span>
                    </div>
                    {[...g.contracts.values()].map(c => (
                        <ContractBlock
                            key={c.contract.name}
                            contract={c.contract}
                            refs={c.refs}
                            highlightType={highlightType}
                            onNavigated={onNavigated}
                            onNavigate={onNavigate}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

function ContractBlock({contract, refs, highlightType, onNavigated, onNavigate}: {
    contract: ContractDoc;
    refs: MethodRef[];
    highlightType?: string;
    onNavigated?: () => void;
    onNavigate?: (path: string) => void;
}) {
    return (
        <div className="mb-1.5 last:mb-0">
            <div className="px-3 flex items-center gap-2 text-[12px] font-semibold text-gray-600">
                <TreeBranch />
                <span>{contract.name}</span>
                <ContractKindTag kind={contract.kind} />
            </div>
            <ul className="relative">
                {/* vertical guide line under the contract */}
                <span className="absolute left-[1.25rem] top-0 bottom-1 w-px bg-gray-200" aria-hidden />
                {refs.map((r, i) => (
                    <li key={i} className="relative">
                        {/* horizontal tick from the vertical guide to the method label */}
                        <span className="absolute left-[1.25rem] top-3.5 w-2.5 h-px bg-gray-200" aria-hidden />
                        <MethodLink ref_={r} highlightType={highlightType} onNavigated={onNavigated} onNavigate={onNavigate} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

function MethodLink({ref_, highlightType, onNavigated, onNavigate}: {
    ref_: MethodRef;
    highlightType?: string;
    onNavigated?: () => void;
    onNavigate?: (path: string) => void;
}) {
    const m = ref_.method;
    const path = `/${ref_.groupSlug}/${ref_.contract.name}/${m.name}` + (highlightType ? `?type=${encodeURIComponent(highlightType)}` : "");
    const className = "w-full text-left pl-9 pr-3 py-1 text-[13px] flex items-center gap-2 hover:bg-gray-50 transition text-gray-700 no-underline";

    const countBadge = ref_.count > 1
        ? <span className="text-[10px] font-mono text-gray-500" title={`${ref_.count} occurrences`}>×{ref_.count}</span>
        : null;

    if (onNavigate) {
        return (
            <button onClick={() => onNavigate(path)} className={className}>
                <ActionBadge method={m} />
                <span className="truncate flex-1 min-w-0">{m.name}</span>
                {countBadge}
                <PatternBadge method={m} />
            </button>
        );
    }
    return (
        <a href={`#${path}`} onClick={onNavigated} className={className}>
            <ActionBadge method={m} />
            <span className="truncate flex-1 min-w-0">{m.name}</span>
            {countBadge}
            <PatternBadge method={m} />
        </a>
    );
}

// Local copies of the tiny presentational pieces so this file is self-contained.

function TreeBranch() {
    return (
        <span className="relative inline-block w-3 h-4 shrink-0" aria-hidden>
            <span className="absolute left-0 top-0 bottom-1/2 w-px bg-gray-300" />
            <span className="absolute left-0 top-1/2 w-2.5 h-px bg-gray-300" />
        </span>
    );
}

function ContractKindTag({kind}: {kind: ContractDoc["kind"]}) {
    if (kind === "ws") {
        return <span className="text-[9px] font-bold uppercase bg-purple-100 text-purple-700 px-1 rounded">WS</span>;
    }
    return <span className="text-[9px] font-bold uppercase bg-sky-100 text-sky-700 px-1 rounded">HTTP</span>;
}

function ActionBadge({method}: {method: MethodDoc}) {
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
    if (method.wsDirection === "client-to-server") {
        return <span className="w-12 inline-block text-[10px] font-bold text-orange-600">OUT</span>;
    }
    if (method.wsDirection === "server-to-client") {
        return <span className="w-12 inline-block text-[10px] font-bold text-indigo-600">IN</span>;
    }
    return <span className="w-12 inline-block" />;
}

function PatternBadge({method}: {method: MethodDoc}) {
    if (method.httpMethod) return null;
    const isEvent = method.wsPattern === "fire-and-forget" || method.wsPattern === "server-push";
    if (isEvent) {
        return (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 px-1 rounded">
                event
            </span>
        );
    }
    return (
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-100 px-1 rounded">
            req
        </span>
    );
}
