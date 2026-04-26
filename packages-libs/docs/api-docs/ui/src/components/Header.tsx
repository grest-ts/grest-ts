import type {ApiDocsDocument, FixtureIndexEntry} from "../docTypes";

interface Props {
    doc: ApiDocsDocument;
    fixtures: FixtureIndexEntry[];
    activeFixture: string;
    onFixtureChange: (slug: string) => void;
}

export function Header({doc, fixtures, activeFixture, onFixtureChange}: Props) {
    return (
        <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-4">
            <a href="#" className="font-bold text-lg flex items-center gap-2">
                <span className="text-blue-500">▸</span>
                <span>{doc.service.name}</span>
            </a>
            {doc.service.version && (
                <span className="text-xs text-gray-500 px-2 py-0.5 rounded bg-gray-100 font-mono">
                    v{doc.service.version}
                </span>
            )}
            {fixtures.length > 0 && (
                <div className="ml-auto flex items-center gap-3">
                    <label className="text-xs uppercase tracking-wider text-gray-500">Fixture</label>
                    <select
                        className="text-sm border border-gray-200 rounded px-2 py-1 bg-white hover:border-gray-400 transition"
                        value={activeFixture}
                        onChange={e => onFixtureChange(e.target.value)}
                    >
                        {fixtures.map(f => (
                            <option key={f.slug} value={f.slug}>
                                {f.title} ({f.methodCount})
                            </option>
                        ))}
                    </select>
                </div>
            )}
        </header>
    );
}
