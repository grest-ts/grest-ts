import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export function resolvePath(relativePath: string, moduleUrl: string): string {
    return join(dirname(fileURLToPath(moduleUrl)), relativePath);
}