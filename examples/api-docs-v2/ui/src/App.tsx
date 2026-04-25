import {useEffect, useMemo, useState} from "react";
import type {ApiDocsDocument, FixtureIndexEntry, ContractDoc, MethodDoc} from "./docTypes";
import {Sidebar} from "./components/Sidebar";
import {Header} from "./components/Header";
import {MethodView} from "./components/MethodView";

export function App() {
    const [index, setIndex] = useState<FixtureIndexEntry[] | null>(null);
    const [activeFixture, setActiveFixture] = useState<string>("realestate");
    const [doc, setDoc] = useState<ApiDocsDocument | null>(null);
    const [route, setRoute] = useState<string>(window.location.hash.slice(1) || "");

    // Load fixture index once
    useEffect(() => {
        fetch("/fixtures/index.json")
            .then(r => r.json())
            .then((data: FixtureIndexEntry[]) => {
                setIndex(data);
                if (data.length > 0 && !data.find(d => d.slug === activeFixture)) {
                    setActiveFixture(data[0].slug);
                }
            });
    }, []);

    // Load active fixture
    useEffect(() => {
        if (!activeFixture) return;
        setDoc(null);
        fetch(`/fixtures/${activeFixture}.json`)
            .then(r => r.json())
            .then(setDoc);
    }, [activeFixture]);

    // Hash-based routing
    useEffect(() => {
        const onHash = () => setRoute(window.location.hash.slice(1));
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);

    const selection = useMemo(() => parseRoute(route, doc), [route, doc]);

    const navigate = (path: string) => {
        window.location.hash = path;
    };

    if (!doc) {
        return (
            <div className="h-full flex items-center justify-center text-gray-500">
                Loading {activeFixture}…
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <Header
                doc={doc}
                fixtures={index ?? []}
                activeFixture={activeFixture}
                onFixtureChange={(slug) => {
                    setActiveFixture(slug);
                    navigate("");
                }}
            />
            <div className="flex-1 flex overflow-hidden">
                <Sidebar doc={doc} selection={selection} onNavigate={navigate} />
                <main className="flex-1 overflow-y-auto bg-gray-50">
                    {selection ? (
                        <MethodView contract={selection.contract} method={selection.method} doc={doc} />
                    ) : (
                        <Welcome doc={doc} />
                    )}
                </main>
            </div>
        </div>
    );
}

function Welcome({doc}: {doc: ApiDocsDocument}) {
    const totalMethods = doc.groups.reduce((s, g) =>
        s + g.contracts.reduce((cs, c) => cs + c.methods.length, 0), 0);
    const totalContracts = doc.groups.reduce((s, g) => s + g.contracts.length, 0);
    return (
        <div className="p-12 max-w-3xl">
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
}

function parseRoute(route: string, doc: ApiDocsDocument | null): Selection | null {
    if (!doc || !route) return null;
    // Format: /<group-slug>/<contract-name>/<method-name>
    const parts = route.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length < 3) return null;
    const [groupSlug, contractName, methodName] = parts;
    const group = doc.groups.find(g => g.slug === groupSlug);
    if (!group) return null;
    const contract = group.contracts.find(c => c.name === contractName);
    if (!contract) return null;
    const method = contract.methods.find(m => m.name === methodName);
    if (!method) return null;
    return {contract, method};
}
