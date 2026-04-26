import {useEffect, useRef, useState} from "react";

export interface TabDef {
    id: string;
    label: React.ReactNode;
    content: React.ReactNode;
}

interface Props {
    tabs: TabDef[];
    defaultId?: string;
}

/** Horizontally-scrolling tab strip with a fade indicator when content overflows. */
export function Tabs({tabs, defaultId}: Props) {
    const [active, setActive] = useState(defaultId ?? tabs[0]?.id);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [overflowRight, setOverflowRight] = useState(false);
    const [overflowLeft, setOverflowLeft] = useState(false);

    const current = tabs.find(t => t.id === active) ?? tabs[0];

    // Detect overflow to show the fade indicators only when needed.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => {
            setOverflowLeft(el.scrollLeft > 4);
            setOverflowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
        };
        onScroll();
        el.addEventListener("scroll", onScroll);
        const ro = new ResizeObserver(onScroll);
        ro.observe(el);
        return () => {
            el.removeEventListener("scroll", onScroll);
            ro.disconnect();
        };
    }, [tabs]);

    return (
        <div>
            <div className="relative -mx-4 px-4 mb-3">
                {overflowLeft && (
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent z-10" />
                )}
                {overflowRight && (
                    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent z-10" />
                )}
                <div
                    ref={scrollRef}
                    className="flex items-center gap-0 border-b border-gray-200 overflow-x-auto scrollbar-thin"
                    style={{scrollbarWidth: "thin"}}
                >
                    {tabs.map(t => {
                        const isActive = t.id === current?.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setActive(t.id)}
                                className={`shrink-0 px-3 py-1.5 text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap ${
                                    isActive
                                        ? "border-blue-500 text-blue-700"
                                        : "border-transparent text-gray-500 hover:text-gray-900"
                                }`}
                            >
                                {t.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {current?.content}
        </div>
    );
}

/**
 * Inline pill-style toggle, small and unobtrusive — used for Example/Schema
 * choices inside a tab.
 */
export function PillToggle<T extends string>({
    options,
    value,
    onChange,
}: {
    options: Array<{id: T; label: React.ReactNode}>;
    value: T;
    onChange: (id: T) => void;
}) {
    return (
        <div className="inline-flex items-center bg-gray-100 rounded-md p-0.5 text-xs">
            {options.map(o => {
                const active = o.id === value;
                return (
                    <button
                        key={o.id}
                        onClick={() => onChange(o.id)}
                        className={`px-2.5 py-1 rounded transition ${
                            active
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-900"
                        }`}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
