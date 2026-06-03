import {GGIssueKey, ValidationIssueJson} from "./GGIssueKey";

export class GGIssuesList {

    // Storage: [ |path, issue, params, value|, |path, issue, params, value|, ...]
    private issues: (string | GGIssueKey | object | undefined | unknown)[] | undefined;
    private _length = 0;

    public add(value: unknown, path: string, issue: GGIssueKey<any>, params?: object): undefined {
        if (this.issues === undefined) {
            this.issues = [path, issue, params, value];
        } else {
            this.issues.push(path, issue, params, value);
        }
        this._length++
        return undefined
    }

    public get length(): number {
        return this._length;
    }

    public getPath(index: number): string | undefined {
        return this.issues?.[index * 4] as string | undefined;
    }

    public getIssue(index: number): GGIssueKey | undefined {
        return this.issues?.[index * 4 + 1] as GGIssueKey | undefined;
    }

    public getParams(index: number): object | undefined {
        return this.issues?.[index * 4 + 2] as object | undefined;
    }

    public getValue(index: number): object | undefined {
        return this.issues?.[index * 4 + 3] as object | undefined;
    }

    /**
     * Get rendered message with template params substituted.
     * Template format: {paramName} gets replaced with param value.
     */
    public getMessage(index: number): string {
        const issue = this.getIssue(index);
        if (!issue) return "";
        const params = this.getParams(index);
        if (!params) return issue.message;
        return issue.message.replace(/\{(\w+)\}/g, (_, key) =>
            String((params as Record<string, unknown>)[key] ?? `{${key}}`)
        );
    }

    public hasIssues() {
        return this.issues !== undefined;
    }

    public toString(): string {
        if (this._length === 0) return "Validation failed";
        const messages: string[] = [];
        for (let i = 0; i < this._length; i++) {
            const path = this.getPath(i);
            const message = this.getMessage(i);
            messages.push(path ? `${path}: ${message}` : message);
        }
        return `Validation failed: ${messages.join("; ")}`;
    }

    public some(predicate: (issue: { path: string, code: string, params?: object }) => boolean): boolean {
        for (let i = 0; i < this._length; i++) {
            const issue = this.getIssue(i)!;
            if (predicate({
                path: this.getPath(i)!,
                code: issue.code,
                params: this.getParams(i)
            })) {
                return true;
            }
        }
        return false;
    }

    /**
     * Convert to JSON with language context.
     * Returns both the issues array and the expectedLanguage (what was requested).
     */
    public toJSON(): ValidationIssueJson[] {
        const issues: ValidationIssueJson[] = [];
        for (let i = 0; i < this._length; i++) {
            const issue = this.getIssue(i)!;
            issues.push(issue.toLocalizedJSON(
                this.getPath(i)!,
                this.getParams(i),
                this.getValue(i)
            ));
        }
        return issues;
    }
}
