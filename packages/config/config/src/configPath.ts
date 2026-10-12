/**
 * Reads a key's value out of a JSON config document: `/app/db/host` → `doc.app.db.host`.
 * Shared by the document-backed stores and GGConfig.check so they resolve paths identically.
 */
export function readConfigPath(doc: unknown, keyName: string): unknown {
    const path = keyName.split("/");
    if (path.length <= 1) return undefined;
    let val: any = doc;
    for (let i = 1; i < path.length; i++) {
        val = val?.[path[i]];
    }
    return val;
}

export function writeConfigPath(doc: Record<string, unknown>, keyName: string, value: unknown): void {
    const segments = keyName.split("/").filter(s => s.length > 0);
    let current = doc;
    for (let i = 0; i < segments.length - 1; i++) {
        if (!current[segments[i]] || typeof current[segments[i]] !== "object") {
            current[segments[i]] = {};
        }
        current = current[segments[i]] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = value;
}
