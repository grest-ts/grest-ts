import {useEffect, useMemo, useState} from "react";
import type {ApiDocsConfig, ApiDocsDocument, ContractDoc, MethodDoc} from "./docTypes";
import {Sidebar} from "./components/Sidebar";
import {Header} from "./components/Header";
import {MethodView} from "./components/MethodView";
import {ActiveSlugContext} from "./lib/activeSlug";
import {buildUsageIndex} from "./lib/usageIndex";

/**
 * Multi-doc UI. Reads `window.GG_API_DOCS_CONFIG` (injected by GGApiDocs
 * or buildApiDocs), surfaces a dropdown to switch between docs, fetches
 * the active doc on demand.
 *
 * Hash routes: `#<slug>/<group>/<contract>/<method>[?type=…]`. The slug
 * portion is what selects the active doc — paste any deep link into the
 * URL bar and the dropdown follows.
 */
declare global {
    interface Window {
        GG_API_DOCS_CONFIG?: ApiDocsConfig;
    }
}

export function App() {
    const config = window.GG_API_DOCS_CONFIG;
    if (!config || config.docs.length === 0) {
        return <ConfigError />;
    }
    return <MultiDocApp config={config} />;
}

function MultiDocApp({config}: {config: ApiDocsConfig}) {
    const initialSlug = pickInitialSlug(config, window.location.hash.slice(1));
    const [activeSlug, setActiveSlug] = useState<string>(initialSlug);
    const [doc, setDoc] = useState<ApiDocsDocument | null>(null);
    const [route, setRoute] = useState<string>(window.location.hash.slice(1) || "");

    const activeEntry = config.docs.find(d => d.slug === activeSlug)!;

    // Fetch the active doc whenever the slug changes.
    useEffect(() => {
        let cancelled = false;
        setDoc(null);
        fetch(activeEntry.url)
            .then(r => r.json())
            .then(d => { if (!cancelled) setDoc(d); });
        return () => { cancelled = true; };
    }, [activeEntry.url]);

    // Hash-based routing — also flips the active doc when the URL slug changes.
    useEffect(() => {
        const onHash = () => {
            const h = window.location.hash.slice(1);
            setRoute(h);
            const slug = parseSlugFromHash(h);
            if (slug && slug !== activeSlug && config.docs.find(d => d.slug === slug)) {
                setActiveSlug(slug);
            }
        };
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, [activeSlug, config.docs]);

    const selection = useMemo(() => parseRoute(route, activeSlug, doc), [route, activeSlug, doc]);
    const usageIndex = useMemo(() => doc ? buildUsageIndex(doc) : null, [doc]);

    const navigate = (path: string) => { window.location.hash = path; };

    const onSlugChange = (slug: string) => {
        setActiveSlug(slug);
        window.location.hash = `/${slug}`;
    };

    return (
        <ActiveSlugContext.Provider value={activeSlug}>
            <div className="h-full flex flex-col">
                <Header
                    doc={doc}
                    docs={config.docs}
                    activeSlug={activeSlug}
                    onSlugChange={onSlugChange}
                />
                {doc ? (
                    <div className="flex-1 flex overflow-hidden">
                        <Sidebar doc={doc} selection={selection} onNavigate={navigate} />
                        <main className="flex-1 overflow-y-auto bg-gray-50">
                            {selection ? (
                                <MethodView
                                    contract={selection.contract}
                                    method={selection.method}
                                    doc={doc}
                                    highlightType={selection.highlightType}
                                    usageIndex={usageIndex ?? undefined}
                                />
                            ) : (
                                <Welcome doc={doc} />
                            )}
                        </main>
                    </div>
                ) : (
                    <Loading label={activeEntry.title} />
                )}
            </div>
        </ActiveSlugContext.Provider>
    );
}

function pickInitialSlug(config: ApiDocsConfig, hash: string): string {
    const fromHash = parseSlugFromHash(hash);
    if (fromHash && config.docs.find(d => d.slug === fromHash)) return fromHash;
    return config.docs[0].slug;
}

function parseSlugFromHash(hash: string): string | null {
    const [pathPart] = hash.split("?");
    const parts = pathPart.replace(/^\/+/, "").split("/").filter(Boolean);
    return parts[0] ?? null;
}

function ConfigError() {
    return (
        <div className="h-full flex items-center justify-center text-gray-500 text-sm px-8 text-center">
            No API docs configured. Inject <code className="px-1 bg-gray-100 rounded">window.GG_API_DOCS_CONFIG</code> with a non-empty <code className="px-1 bg-gray-100 rounded">docs</code> array.
        </div>
    );
}

function Loading({label}: {label?: string}) {
    return (
        <div className="flex-1 flex items-center justify-center text-gray-500">
            Loading{label ? ` ${label}` : ""}…
        </div>
    );
}

function Welcome({doc}: {doc: ApiDocsDocument}) {
    const totalMethods = doc.groups.reduce((s, g) =>
        s + g.contracts.reduce((cs, c) => cs + c.methods.length, 0), 0);
    const totalContracts = doc.groups.reduce((s, g) => s + g.contracts.length, 0);
    return (
        <div className="px-8 py-8 max-w-[1800px]">
            <h1 className="text-3xl font-bold mb-2">{doc.service.name}</h1>
            {doc.service.version && (
                <div className="text-sm text-gray-500 mb-6">v{doc.service.version}</div>
            )}
            {doc.service.description && (
                <p className="text-gray-700 mb-8 text-lg leading-relaxed">{doc.service.description}</p>
            )}
            <div className="grid grid-cols-3 gap-4 mb-8">
                <Stat label="Groups" value={doc.groups.length} />
                <Stat label="Contracts" value={totalContracts} />
                <Stat label="Methods" value={totalMethods} />
            </div>
            <div className="text-sm text-gray-500 mb-2">Groups</div>
            <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
                {doc.groups.map(g => (
                    <li key={g.slug} className="px-4 py-3">
                        <div className="font-medium">{g.name}</div>
                        {g.description && <div className="text-sm text-gray-500 mt-1">{g.description}</div>}
                        <div className="text-xs text-gray-400 mt-1">
                            {g.contracts.length} contract{g.contracts.length === 1 ? "" : "s"} ·
                            {" "}{g.contracts.reduce((s, c) => s + c.methods.length, 0)} method
                            {g.contracts.reduce((s, c) => s + c.methods.length, 0) === 1 ? "" : "s"}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Stat({label, value}: {label: string; value: number}) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs uppercase text-gray-500 tracking-wider mt-1">{label}</div>
        </div>
    );
}

interface Selection {
    contract: ContractDoc;
    method: MethodDoc;
    /** Generic type-highlight: a brand name, or `__<canonicalId>` for anonymous types, or `__error_<TYPE>` for errors. */
    highlightType?: string;
}

/**
 * Route format: `<slug>/<group>/<contract>/<method>[?type=…]`. Leading
 * slashes are tolerated. The slug portion drives `activeSlug`; if it
 * doesn't match the currently-loaded doc, no selection is returned.
 */
function parseRoute(route: string, activeSlug: string, doc: ApiDocsDocument | null): Selection | null {
    if (!doc || !route) return null;
    const [pathPart, queryPart] = route.split("?");
    const parts = pathPart.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length < 4) return null;
    const [slug, groupSlug, contractName, methodName] = parts;
    if (slug !== activeSlug) return null;
    const group = doc.groups.find(g => g.slug === groupSlug);
    if (!group) return null;
    const contract = group.contracts.find(c => c.name === contractName);
    if (!contract) return null;
    const method = contract.methods.find(m => m.name === methodName);
    if (!method) return null;

    let highlightType: string | undefined;
    if (queryPart) {
        const params = new URLSearchParams(queryPart);
        highlightType = params.get("type") ?? params.get("brand") ?? undefined;
    }
    return {contract, method, highlightType};
}
