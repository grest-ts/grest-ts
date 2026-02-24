import {isNode} from "@grest-ts/common";

/**
 * Get default adapter - lazy loaded to avoid top-level await
 */
export async function getDefaultAdapter(): Promise<any> {
    if (isNode()) {
        const {NodeSocketAdapter} = await import('./NodeSocketAdapter');
        return NodeSocketAdapter;
    } else {
        const {BrowserSocketAdapter} = await import('./BrowserSocketAdapter');
        return BrowserSocketAdapter;
    }
}