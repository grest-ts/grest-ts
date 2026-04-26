import {useMemo, useState} from "react";
import type {ApiDocsDocument, ContractDoc, MethodDoc} from "../docTypes";
import {PatternBadge} from "./Badges";
import {buildBrandIndex, type MethodRef} from "../lib/brandIndex";
import {MethodTree} from "./MethodTree";

interface Selection {
    contract: ContractDoc;
    method: MethodDoc;
    /** Generic type-highlight handle — brand, title, or `__<canonicalId>`. */
    highlightType?: string;
}

interface Props {
    doc: ApiDocsDocument;
    selection: Selection | null;
    onNavigate: (path: string) => void;
}

type SidebarTab = "groups" | "brands";

export function Sidebar({doc, selection, onNavigate}: Props) {
    const [tab, setTab] = useState<SidebarTab>("groups");
    const brandIndex = useMemo(() => buildBrandIndex(doc), [doc]);

    return (
        <aside className="w-80 shrink-0 bg-white border-r border-gray-200 overflow-y-auto flex flex-col">
            <div className="flex border-b border-gray-200 sticky top-0 bg-white z-10 shrink-0">
                <SidebarTabButton active={tab === "groups"} onClick={() => setTab("groups")}>
                    Groups
                </SidebarTabButton>
                <SidebarTabButton active={tab === "brands"} onClick={() => setTab("brands")}>
                    Brands
                    {brandIndex.size > 0 && <span className="text-gray-400 ml-1.5">{brandIndex.size}</span>}
                </SidebarTabButton>
            </div>
            {tab === "groups" && <GroupsView doc={doc} selection={selection} onNavigate={onNavigate} />}
            {tab === "brands" && <BrandsView doc={doc} brandIndex={brandIndex} selection={selection} onNavigate={onNavigate} />}
        </aside>
    );
}

function SidebarTabButton({active, onClick, children}: {active: boolean; onClick: () => void; children: React.ReactNode}) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 px-3 py-2 text-[13px] font-semibold transition border-b-2 -mb-px ${
                active
                    ? "border-blue-500 text-blue-700"
                    : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
        >
            {children}
        </button>
    );
}

// ── Groups view ────────────────────────────────────────────────────────

function GroupsView({doc, selection, onNavigate}: Props) {
    const [filter, setFilter] = useState("");
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

    /**
     * Default rule:
     *   - Manual override (clicked open/closed) wins.
     *   - Active filter expands all matching groups.
     *   - Else: auto-expand the group that contains the currently-selected
     *     method, so opening any API surfaces it in the sidebar with no
     *     extra click. Brands tab intentionally does NOT do this — that one
     *     stays fully user-controlled.
     */
    const isExpanded = (slug: string): boolean => {
        if (override[slug] !== undefined) return override[slug];
        if (filter.trim()) return true;
        if (selection) {
            const group = doc.groups.find(g => g.slug === slug);
            if (group?.contracts.some(c => c.name === selection.contract.name && c.methods.some(m => m.name === selection.method.name))) {
                return true;
            }
        }
        return false;
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <FilterInput value={filter} onChange={setFilter} placeholder="Filter…" />
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
                {filtered.length === 0 && <EmptyState>No matches.</EmptyState>}
            </nav>
        </div>
    );
}

function GroupItem({
    group, expanded, toggle, onNavigate, selection,
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
        <div>
            <button
                onClick={toggle}
                className={`w-full px-3 py-2 text-left flex items-center justify-between transition border-y border-transparent ${
                    expanded ? "bg-gray-100 border-gray-200 text-gray-900" : "hover:bg-gray-50 text-gray-700"
                }`}
            >
                <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold tracking-tight">{group.name}</span>
                    <span className="text-[10px] text-gray-400 font-normal">{contractCount} · {methodCount}</span>
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
    contract, groupSlug, onNavigate, selection,
}: {
    contract: ContractDoc;
    groupSlug: string;
    onNavigate: (path: string) => void;
    selection: Selection | null;
}) {
    return (
        <div className="mb-1.5">
            <div className="px-3 flex items-center gap-2 text-[12px] font-semibold text-gray-600">
                <TreeBranch />
                <span>{contract.name}</span>
                <ContractKindTag kind={contract.kind} />
            </div>
            <ul className="relative">
                <span className="absolute left-[1.25rem] top-0 bottom-1 w-px bg-gray-200" aria-hidden />
                {contract.methods.map(method => (
                    <li key={method.name} className="relative">
                        <span className="absolute left-[1.25rem] top-3.5 w-2.5 h-px bg-gray-200" aria-hidden />
                        <MethodRow
                            method={method}
                            contract={contract}
                            groupSlug={groupSlug}
                            selection={selection}
                            onNavigate={onNavigate}
                            indent="pl-9"
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ── Brands view ────────────────────────────────────────────────────────

function BrandsView({
    doc, brandIndex, selection, onNavigate,
}: Props & {brandIndex: Map<string, MethodRef[]>}) {
    const [filter, setFilter] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const sortedBrands = useMemo(() => {
        const all = [...brandIndex.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const f = filter.trim().toLowerCase();
        if (!f) return all;
        // Filter on brand name OR on any method name within the brand's usage list.
        return all.filter(([brand, refs]) =>
            brand.toLowerCase().includes(f)
            || refs.some(r => r.method.name.toLowerCase().includes(f) || r.contract.name.toLowerCase().includes(f))
        );
    }, [brandIndex, filter]);

    /**
     * Default expand decision:
     *   - manual override wins (clicked open / clicked closed)
     *   - active filter expands all matching brands
     *   - else: only the brand carried in the URL (`?brand=X`) is expanded;
     *     all others stay collapsed regardless of which method is selected.
     */
    const isExpanded = (brand: string): boolean => {
        if (expanded[brand] !== undefined) return expanded[brand];
        if (filter.trim()) return true;
        if (selection?.highlightType === brand) return true;
        return false;
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <FilterInput value={filter} onChange={setFilter} placeholder="Filter brands…" />
            <nav className="py-2">
                {sortedBrands.map(([brand, refs]) => (
                    <BrandItem
                        key={brand}
                        brand={brand}
                        refs={refs}
                        expanded={isExpanded(brand)}
                        toggle={() => setExpanded(e => ({...e, [brand]: !isExpanded(brand)}))}
                        selection={selection}
                        onNavigate={onNavigate}
                    />
                ))}
                {sortedBrands.length === 0 && <EmptyState>{brandIndex.size === 0 ? "No brands found." : "No matches."}</EmptyState>}
            </nav>
        </div>
    );
}

function BrandItem({
    brand, refs, expanded, toggle, onNavigate,
}: {
    brand: string;
    refs: MethodRef[];
    expanded: boolean;
    toggle: () => void;
    selection: Selection | null;
    onNavigate: (path: string) => void;
}) {
    return (
        <div>
            <button
                onClick={toggle}
                className={`w-full px-3 py-2 text-left flex items-center justify-between transition border-y border-transparent ${
                    expanded ? "bg-gray-100 border-gray-200 text-gray-900" : "hover:bg-gray-50 text-gray-700"
                }`}
            >
                <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-purple-700">{brand}</span>
                    <span className="text-[10px] text-gray-400 font-normal">{refs.length}</span>
                </span>
            </button>
            {expanded && (
                <div className="py-1.5 bg-white">
                    {/* Same MethodTree the popover uses — Group → Contract → Methods,
                        with per-method occurrence counts surfaced from MethodRef.count. */}
                    <MethodTree refs={refs} highlightType={brand} onNavigate={onNavigate} />
                </div>
            )}
        </div>
    );
}

// ── Shared: method row, used by both views with identical layout ───────

function MethodRow({
    method, contract, groupSlug, selection, onNavigate, indent, showContract, highlightType,
}: {
    method: MethodDoc;
    contract: ContractDoc;
    groupSlug: string;
    selection: Selection | null;
    onNavigate: (path: string) => void;
    indent: string;
    showContract?: boolean;
    /** When set, the navigated URL carries `?type=X` so the method view highlights it. */
    highlightType?: string;
}) {
    const isActive = selection?.contract.name === contract.name && selection.method.name === method.name;
    const target = `/${groupSlug}/${contract.name}/${method.name}` + (highlightType ? `?type=${encodeURIComponent(highlightType)}` : "");
    return (
        <button
            onClick={() => onNavigate(target)}
            className={`w-full text-left ${indent} pr-3 py-1 text-[13px] flex items-center gap-2 transition ${
                isActive ? "bg-blue-50 text-blue-900 font-medium" : "hover:bg-gray-50 text-gray-700"
            }`}
        >
            <ActionBadge method={method} />
            <span className="truncate flex-1 min-w-0">
                {method.name}
                {showContract && (
                    <span className="ml-2 text-[10px] text-gray-400 font-normal">{contract.name}</span>
                )}
            </span>
            <PatternBadge method={method} />
        </button>
    );
}

// ── Shared building blocks ─────────────────────────────────────────────

function FilterInput({value, onChange, placeholder}: {value: string; onChange: (v: string) => void; placeholder?: string}) {
    return (
        <div className="p-3 border-b border-gray-200 sticky top-0 bg-white z-10">
            <input
                type="text"
                placeholder={placeholder ?? "Filter…"}
                className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 outline-none focus:border-blue-500 transition"
                value={value}
                onChange={e => onChange(e.target.value)}
            />
        </div>
    );
}

function EmptyState({children}: {children: React.ReactNode}) {
    return <div className="px-4 py-8 text-sm text-gray-400 text-center">{children}</div>;
}

function ContractKindTag({kind}: {kind: ContractDoc["kind"]}) {
    if (kind === "ws") {
        return <span className="text-[9px] font-bold uppercase bg-purple-100 text-purple-700 px-1 rounded">WS</span>;
    }
    return <span className="text-[9px] font-bold uppercase bg-sky-100 text-sky-700 px-1 rounded">HTTP</span>;
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
    if (method.wsDirection === "client-to-server") {
        return <span className="w-12 inline-block text-[10px] font-bold text-orange-600">OUT</span>;
    }
    if (method.wsDirection === "server-to-client") {
        return <span className="w-12 inline-block text-[10px] font-bold text-indigo-600">IN</span>;
    }
    return <span className="w-12 inline-block" />;
}
