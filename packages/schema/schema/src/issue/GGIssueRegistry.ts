import type {GGIssueKey} from "./GGIssueKey";

export class GGIssueRegistry {

    private static issues: Map<string, GGIssueKey> = new Map();

    private readonly translations: Map<string, Record<string, string>> = new Map();

    public static register(issue: GGIssueKey<any>) {
        if (this.issues.has(issue.code)) {
            throw new Error(`Validation error code '${issue.code}' is already registered`)
        }
        this.issues.set(issue.code, issue)
    }

    public static toJSON() {
        const keys: any = {};
        this.issues.forEach((issue, key) => {
            const parts = key.split(".");
            let cur = keys;

            for (let i = 0; i < parts.length; i++) {
                const subKey = parts[i];

                if (i === parts.length - 1) {
                    // Final position - set $value with issue's JSON
                    if (cur[subKey] === undefined) {
                        cur[subKey] = {};
                    }
                    cur[subKey].$value = issue.toJSON();
                } else {
                    // Intermediate - ensure object and traverse
                    if (cur[subKey] === undefined) {
                        cur[subKey] = {};
                    }
                    cur = cur[subKey];
                }
            }
        });
        return keys;
    }

    public addLanguage(lang: string, translations: Record<string, string>) {
        this.translations.set(lang, translations);
    }

    public getTranslation(lang: string, code: string): string | undefined {
        return this.translations.get(lang)?.[code] ?? GGIssueRegistry.issues.get(lang)?.message ?? undefined;
    }

    public static getTranslation(lang: string, code: string): string | undefined {
        // @TODO Find instance from async
        return undefined;
    }
}