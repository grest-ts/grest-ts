import {useMemo, useState} from "react";
import type {ApiDocsDocument, ContractDoc, MethodDoc} from "../docTypes";
import {PatternBadge} from "./Badges";

interface Selection {
    contract: ContractDoc;
    method: MethodDoc;
}

interface Props {
    doc: ApiDocsDocument;
    selection: Selection | null;
    onNavigate: (path: string) => void;
}

export function Sidebar({doc, selection, onNavigate}: Props) {
    const [filter, setFilter] = useState("");
    /** Per-group manual expand override. Undefined = follow defaults. */
    const [override, setOverride] = useState<Record<string, boolean>>({});

    const filtered = useMemo(() => {
        const f = filter.trim().toLowerCase();
        if (!f) return doc.groups;
        return doc.groups
            .map(g => ({
                ...g,
                contracts: g.contracts
                    .map(c => ({
                        ...c,
                        methods: c.methods.filter(m =>
                            m.name.toLowerCase().includes(f) ||
                            (m.summary?.toLowerCase().includes(f)) ||
                            (m.httpPath?.toLowerCase().includes(f)) ||
                            c.name.toLowerCase().includes(f)
                        ),
                    }))
                    .filter(c => c.methods.length > 0),
            }))
            .filter(g => g.contracts.length > 0);
    }, [filter, doc.groups]);

    /** Default behavior: collapsed unless filtering, or unless this group contains the current selection. */
    const isExpanded = (slug: string): boolean => {
        if (override[slug] !== undefined) return override[slug];
        if (filter.trim()) return true;
        if (selection && doc.groups.find(g => g.slug === slug)?.contracts.some(c => c.name === selection.contract.name)) return true;
        return false;
    };

    return (
        <aside className="w-80 shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
            <div className="p-3 border-b border-gray-200 sticky top-0 bg-white z-10">
                <input
                    type="text"
                    placeholder="Filter…"
                    className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 outline-none focus:border-blue-500 transition"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
            </div>
            <nav className="py-2">
                {filtered.map(group => (
                    <GroupItem
                        key={group.slug}
                        group={group}
                        expanded={isExpanded(group.slug)}
                        toggle={() => setOverride(o => ({...o, [group.slug]: !isExpanded(group.slug)}))}
                        onNavigate={onNavigate}
                        selection={selection}
                    />
                ))}
                {filtered.length === 0 && (
                    <div className="px-4 py-8 text-sm text-gray-400 text-center">
                        No matches.
                    </div>
                )}
            </nav>
        </aside>
    );
}

function GroupItem({
    group,
    expanded,
    toggle,
    onNavigate,
    selection,
}: {
    group: ApiDocsDocument["groups"][number];
    expanded: boolean;
    toggle: () => void;
    onNavigate: (path: string) => void;
    selection: Selection | null;
}) {
    const methodCount = group.contracts.reduce((s, c) => s + c.methods.length, 0);
    const contractCount = group.contracts.length;
    return (
        <div className="mb-0">
            <button
                onClick={toggle}
                className={`w-full px-3 py-2 text-left flex items-center justify-between transition border-y border-transparent ${
                    expanded
                        ? "bg-gray-100 border-gray-200 text-gray-900"
                        : "hover:bg-gray-50 text-gray-700"
                }`}
            >
                <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold tracking-tight">{group.name}</span>
                    <span className="text-[10px] text-gray-400 font-normal">
                        {contractCount} · {methodCount}
                    </span>
                </span>
            </button>
            {expanded && (
                <div className="py-1.5 bg-white">
                    {group.contracts.map(contract => (
                        <ContractItem
                            key={contract.name}
                            contract={contract}
                            groupSlug={group.slug}
                            onNavigate={onNavigate}
                            selection={selection}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ContractItem({
    contract,
    groupSlug,
    onNavigate,
    selection,
}: {
    contract: ContractDoc;
    groupSlug: string;
    onNavigate: (path: string) => void;
    selection: Selection | null;
}) {
    return (
        <div className="mb-1.5">
            {/* Contract header — indented with a tree-line guide.
                Tag (HTTP / WS) sits after the name for visual symmetry. */}
            <div className="px-3 flex items-center gap-2 text-[12px] font-semibold text-gray-600">
                <TreeBranch />
                <span>{contract.name}</span>
                {contract.kind === "ws" ? (
                    <span className="text-[9px] font-bold uppercase bg-purple-100 text-purple-700 px-1 rounded">WS</span>
                ) : (
                    <span className="text-[9px] font-bold uppercase bg-sky-100 text-sky-700 px-1 rounded">HTTP</span>
                )}
            </div>
            <ul className="relative">
                {/* Vertical guide line under the contract for its methods */}
                <span className="absolute left-[1.25rem] top-0 bottom-1 w-px bg-gray-200" aria-hidden />
                {contract.methods.map(method => {
                    const isActive = selection?.contract.name === contract.name && selection.method.name === method.name;
                    return (
                        <li key={method.name} className="relative">
                            {/* Horizontal tick from the vertical guide to the method label */}
                            <span className="absolute left-[1.25rem] top-3.5 w-2.5 h-px bg-gray-200" aria-hidden />
                            <button
                                onClick={() => onNavigate(`/${groupSlug}/${contract.name}/${method.name}`)}
                                className={`w-full text-left pl-9 pr-3 py-1 text-[13px] flex items-center gap-2 transition ${
                                    isActive
                                        ? "bg-blue-50 text-blue-900 font-medium"
                                        : "hover:bg-gray-50 text-gray-700"
                                }`}
                            >
                                <ActionBadge method={method} />
                                <span className="truncate flex-1 min-w-0">{method.name}</span>
                                <PatternBadge method={method} />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/**
 * Small ├─ glyph drawn with two divs — used to anchor a contract header
 * to the group it belongs to. Looks like a JetBrains/VSCode tree branch.
 */
function TreeBranch() {
    return (
        <span className="relative inline-block w-3 h-4 shrink-0" aria-hidden>
            <span className="absolute left-0 top-0 bottom-1/2 w-px bg-gray-300" />
            <span className="absolute left-0 top-1/2 w-2.5 h-px bg-gray-300" />
        </span>
    );
}

/** Verb (HTTP) or direction (WS) — colored short label, fixed-width column. */
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
    // WS — IN/OUT from the client's perspective (the typical doc reader is writing client code).
    if (method.wsDirection === "client-to-server") {
        return <span className="w-12 inline-block text-[10px] font-bold text-orange-600">OUT</span>;
    }
    if (method.wsDirection === "server-to-client") {
        return <span className="w-12 inline-block text-[10px] font-bold text-indigo-600">IN</span>;
    }
    return <span className="w-12 inline-block" />;
}
