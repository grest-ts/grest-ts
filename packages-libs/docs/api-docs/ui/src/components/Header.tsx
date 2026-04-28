import type {ApiDocsConfigEntry, ApiDocsDocument} from "../docTypes";

interface Props {
    /** May be null while the active doc is still loading — header still renders. */
    doc: ApiDocsDocument | null;
    docs: ApiDocsConfigEntry[];
    activeSlug: string;
    onSlugChange: (slug: string) => void;
}

/**
 * Top bar: brand on the left, doc-switcher dropdown on the right.
 * Dropdown is hidden when there's only one doc — no useful choice to offer.
 */
export function Header({doc, docs, activeSlug, onSlugChange}: Props) {
    const activeEntry = docs.find(d => d.slug === activeSlug);
    const titleText = doc?.service.name ?? activeEntry?.title ?? "API Docs";
    const versionText = doc?.service.version;
    return (
        <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-4">
            <a href="#" className="font-bold text-lg flex items-center gap-2">
                <span className="text-blue-500">▸</span>
                <span>{titleText}</span>
            </a>
            {versionText && (
                <span className="text-xs text-gray-500 px-2 py-0.5 rounded bg-gray-100 font-mono">
                    v{versionText}
                </span>
            )}
            {docs.length > 1 && (
                <div className="ml-auto flex items-center gap-3">
                    <label className="text-xs uppercase tracking-wider text-gray-500">API</label>
                    <select
                        className="text-sm border border-gray-200 rounded px-2 py-1 bg-white hover:border-gray-400 transition"
                        value={activeSlug}
                        onChange={e => onSlugChange(e.target.value)}
                    >
                        {docs.map(d => (
                            <option key={d.slug} value={d.slug}>
                                {d.title}
                            </option>
                        ))}
                    </select>
                </div>
            )}
        </header>
    );
}
