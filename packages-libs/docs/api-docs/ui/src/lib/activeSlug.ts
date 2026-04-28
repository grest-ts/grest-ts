/**
 * Provides the slug of the currently-active doc to deep components that
 * construct hash-route URLs (Sidebar's MethodRow, MethodTree's MethodLink).
 *
 * Hash routes are slug-prefixed: `#<slug>/<group>/<contract>/<method>`. The
 * slug isn't visible at the call site that builds a row, so we read it from
 * context instead of prop-drilling through every wrapper.
 */
import {createContext, useContext} from "react";

export const ActiveSlugContext = createContext<string>("");

export function useActiveSlug(): string {
    return useContext(ActiveSlugContext);
}
