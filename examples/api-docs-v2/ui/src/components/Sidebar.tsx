import {useMemo, useState} from "react";
import type {ApiDocsDocument, ContractDoc, MethodDoc} from "../docTypes";

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
    return (
        <div className="mb-1">
            <button
                onClick={toggle}
                className="w-full px-4 py-1.5 text-left text-xs uppercase tracking-wider text-gray-500 font-semibold flex items-center justify-between hover:text-gray-900 transition"
            >
                <span className="flex items-center gap-2">
                    <span className="text-gray-300 text-[10px] font-normal w-2">{expanded ? "▾" : "▸"}</span>
                    <span>{group.name}</span>
                    <span className="text-gray-400 text-[10px] font-normal normal-case tracking-normal">{methodCount}</span>
                </span>
            </button>
            {expanded && group.contracts.map(contract => (
                <ContractItem
                    key={contract.name}
                    contract={contract}
                    groupSlug={group.slug}
                    onNavigate={onNavigate}
                    selection={selection}
                />
            ))}
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
        <div className="mb-2">
            <div className="px-4 py-1 text-[13px] font-semibold text-gray-700 flex items-center gap-2">
                {contract.kind === "ws" && (
                    <span className="text-[10px] font-bold uppercase bg-purple-100 text-purple-700 px-1.5 rounded">WS</span>
                )}
                <span>{contract.name}</span>
            </div>
            <ul>
                {contract.methods.map(method => {
                    const isActive = selection?.contract.name === contract.name && selection.method.name === method.name;
                    return (
                        <li key={method.name}>
                            <button
                                onClick={() => onNavigate(`/${groupSlug}/${contract.name}/${method.name}`)}
                                className={`w-full text-left px-4 py-1 text-[13px] flex items-center gap-2 transition border-l-2 ${
                                    isActive
                                        ? "bg-blue-50 border-blue-500 text-blue-900 font-medium"
                                        : "border-transparent hover:bg-gray-50 text-gray-700"
                                }`}
                            >
                                <MethodBadge method={method} />
                                <span className="truncate">{method.name}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function MethodBadge({method}: {method: MethodDoc}) {
    if (method.httpMethod) {
        const colors: Record<string, string> = {
            GET: "text-blue-600",
            POST: "text-green-600",
            PUT: "text-amber-600",
            PATCH: "text-amber-600",
            DELETE: "text-red-600",
        };
        return (
            <span className={`text-[10px] font-bold w-12 shrink-0 ${colors[method.httpMethod] ?? "text-gray-500"}`}>
                {method.httpMethod}
            </span>
        );
    }
    if (method.wsDirection) {
        const arrow = method.wsDirection === "client-to-server" ? "→" : "←";
        return <span className="text-purple-500 w-12 shrink-0 text-xs">{arrow} WS</span>;
    }
    return <span className="w-12 shrink-0" />;
}
