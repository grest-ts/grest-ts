import {createContext, useContext} from "react";

export const ActiveSlugContext = createContext<string>("");

export function useActiveSlug(): string {
    return useContext(ActiveSlugContext);
}
