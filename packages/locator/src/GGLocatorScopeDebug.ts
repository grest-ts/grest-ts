// Console ANSI colors - defined inline to avoid circular dependency with @grest-ts/logger
const LOG_COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
};

export interface GGLocatorDebugService {
    key: string;
    className: string | undefined;
    stack: string[];
    composeLine: string | undefined;
}

export interface GGLocatorRawServiceData {
    key: string;
    value: any;
    rawStack: string[];
}

export class GGLocatorScopeDebugList {

    public readonly scopes: GGLocatorScopeDebug[] = [];

    public add(tree: GGLocatorScopeDebug) {
        this.scopes.push(tree);
    }

    public toString(color: boolean = false): string {
        return this.scopes.map(t => t.toString(color)).join("\n\n");
    }

    public toJSON(): object {
        return {
            scopes: this.scopes.map(s => s.toJSON())
        };
    }

}

export class GGLocatorScopeDebug {

    public readonly scopeName: string;
    public readonly creationStack: string[];
    public readonly services: GGLocatorDebugService[] = [];

    constructor(scopeName: string, rawCreationStack: string[]) {
        this.scopeName = scopeName;
        this.creationStack = this.processCreationStack(rawCreationStack);
    }

    private processCreationStack(rawStack: string[]): string[] {
        return rawStack
            .map(line => this.normalizeStackLine(line))
            .filter((line): line is string => line !== undefined);
    }

    public add(key: string, value: any, rawStack: string[] | undefined): void {
        this.services.push(this.processService({key: key, value, rawStack: rawStack ?? []}));
    }

    private processService(raw: GGLocatorRawServiceData): GGLocatorDebugService {
        const className = raw.value?.constructor?.name;

        // Find compose index and trim stack up to and including compose
        const composeIndex = raw.rawStack.findIndex(line => line.includes('.compose'));
        const trimmedStack = composeIndex >= 0
            ? raw.rawStack.slice(0, composeIndex + 1)
            : raw.rawStack;

        return {
            key: raw.key,
            className: className !== 'Object' ? className : undefined,
            stack: trimmedStack
                .map(line => this.normalizeStackLine(line))
                .filter((line): line is string => line !== undefined),
            composeLine: this.findComposeLine(raw.rawStack)
        };
    }

    private normalizeStackLine(line: string): string | undefined {
        const trimmed = line.trim();
        if (!trimmed) return undefined;

        // Extract "at ClassName.method (file:line)" or just the location
        const match = trimmed.match(/at\s+(.+)/);
        const location = match ? match[1] : trimmed;
        return this.normalizePathToFileUrl(location);
    }

    private findComposeLine(stack: string[]): string | undefined {
        const composeLine = stack.find(line => line.includes('.compose'));
        if (!composeLine) return undefined;
        return this.normalizeStackLine(composeLine);
    }

    private normalizePathToFileUrl(location: string): string {
        // Convert Windows paths to file:// URLs for better IDE support
        // Matches: (C:\path\file.ts:10:5) or C:\path\file.ts:10:5
        return location.replace(/([\w]:[\\/][^:)]+:\d+:\d+)/g, (path) => {
            const normalizedPath = path.replace(/\\/g, '/');
            return `file:///${normalizedPath}`;
        });
    }

    public toString(color: boolean = false): string {
        const C = color ? LOG_COLORS : {reset: "", bright: "", dim: "", cyan: "", yellow: "", green: "", gray: "", magenta: "", blue: ""};
        const lines: string[] = [];

        lines.push(`${C.bright}${C.cyan}Scope: ${this.scopeName}${C.reset}`);

        if (this.creationStack.length > 0) {
            lines.push(`\t${C.dim}Created at:${C.reset}`);
            for (const frame of this.creationStack) {
                lines.push(`\t\t${C.gray}${frame}${C.reset}`);
            }
        }

        lines.push(`\t${C.dim}---${C.reset}`);

        for (const service of this.services) {
            const className = service.className ? `${C.dim} (${service.className})${C.reset}` : "";
            lines.push(`\t${C.yellow}${service.key}${C.reset}${className}`);

            if (service.composeLine) {
                lines.push(`\t\t${C.green}compose: ${C.reset}${C.gray}${service.composeLine}${C.reset}`);
            }

            if (service.stack.length > 0) {
                lines.push(`\t\t${C.dim}stack:${C.reset}`);
                for (const frame of service.stack) {
                    lines.push(`\t\t\t${C.gray}${frame}${C.reset}`);
                }
            }
        }

        return lines.join("\n");
    }

    public toJSON(): object {
        return {
            scopeName: this.scopeName,
            creationStack: this.creationStack,
            services: this.services
        };
    }
}
