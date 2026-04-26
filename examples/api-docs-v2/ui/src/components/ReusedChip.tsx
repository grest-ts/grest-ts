/**
 * Small "↔ N" chip rendered inline next to a schema in the body when that
 * exact schema (by canonicalId) flows through 2+ methods.
 *
 * On click: opens a floating popover (portaled to <body> with fixed
 * positioning, so it doesn't push container scroll) containing the same
 * group → method tree layout as the Brands tab. Each method row is an
 * `<a href="#/...">` so cmd/ctrl-click opens it in a new tab.
 *
 * Currently-active method is excluded from the list by the caller.
 */

import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import type {MethodRef} from "../lib/brandIndex";
import {MethodTree} from "./MethodTree";

interface Props {
    refs: MethodRef[];
    /** Type identifier used in `?type=X` for navigation links — keeps highlighting alive. */
    highlightType: string;
    /** When true, this chip's schema is the active highlight target — chip gets yellow accent. */
    highlighted?: boolean;
}

export function ReusedChip({refs, highlightType, highlighted}: Props) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState<{top: number; left: number} | null>(null);

    /** Recompute popover position when it opens (anchored to chip's bounding rect). */
    useLayoutEffect(() => {
        if (!open || !buttonRef.current) return;
        const update = () => {
            const rect = buttonRef.current!.getBoundingClientRect();
            setPosition({top: rect.bottom + 4, left: rect.left});
        };
        update();
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [open]);

    /** Close on outside click / Escape. */
    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            const target = e.target as Node;
            if (buttonRef.current?.contains(target)) return;
            // Allow clicks inside the popover (it stops propagation in its handler).
            const popover = document.getElementById("gg-reused-popover");
            if (popover?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (refs.length === 0) return null;

    return (
        <>
            <button
                ref={buttonRef}
                onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
                className={`text-[10px] font-mono px-1.5 py-0 rounded not-italic transition align-middle ml-1.5 inline-block ${
                    highlighted
                        ? "bg-yellow-200 ring-1 ring-yellow-400 text-yellow-900 font-bold"
                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                }`}
                title={`Same schema used in ${refs.length} method${refs.length === 1 ? "" : "s"}`}
            >
                ↔ {refs.length}
            </button>
            {open && position && createPortal(
                <div
                    id="gg-reused-popover"
                    className="fixed z-50 min-w-[300px] max-w-[440px] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
                    style={{top: position.top, left: position.left}}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                        Same schema · {refs.length} use{refs.length === 1 ? "" : "s"}
                    </div>
                    <div className="max-h-96 overflow-y-auto py-1.5">
                        <MethodTree
                            refs={refs}
                            highlightType={highlightType}
                            onNavigated={() => setOpen(false)}
                        />
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}

