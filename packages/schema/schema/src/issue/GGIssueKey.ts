import {GGIssuesList} from "./GGIssuesList";
import {GGIssueRegistry} from "./GGIssueRegistry";

/** Helper type to check if an object type has any keys */
type HasKeys<T> = keyof T extends never ? false : true;

/** Maps param keys to string descriptions */
type ParamDescriptions<T> = { [K in keyof T]: string };

type Params<TParams> = HasKeys<TParams> extends true ? [params: TParams] : [];

/**
 * Base validation issue class with optional typed parameters for message templating.
 *
 * @template TParams - Object type for template parameters. Use `object` (default) for no params.
 *
 * @example
 * // Issue without params
 * const required = new GGIssue("required", "Value is required");
 * required.add(value, issues, path);
 *
 * // Issue with params
 * const tooShort = new GGIssue<{min: number}>("tooShort", "Minimum {min} characters", {min: "Minimum length"});
 * tooShort.add(value, issues, path, {min: 8});
 */
export class GGIssueKey<TParams extends object = {}> {

    public static readonly required = new GGIssueKey("required", "Value is required");

    public readonly code: string;
    public readonly message: string;
    public readonly paramDescriptions?: ParamDescriptions<TParams>;

    private static localizer: (issue: ValidationIssueJson) => void

    constructor(
        code: string,
        message: string,
        ...paramDescriptions: keyof TParams extends never ? [] : [params: ParamDescriptions<TParams>]
    ) {
        this.code = code;
        this.message = message;
        this.paramDescriptions = paramDescriptions[0] as any;
        GGIssueRegistry.register(this);
    }

    public static setLocalizer(localizer: (issue: ValidationIssueJson) => void) {
        this.localizer = localizer;
    }

    /**
     * Add this issue to the issues list.
     * If TParams has keys, params argument is required; otherwise it's omitted.
     */
    public add(
        value: unknown,
        issues: GGIssuesList,
        path: string,
        ...args: Params<TParams>
    ): false {
        issues.add(value, path, this, args[0]);
        return false;
    }

    public toJSON() {
        return {
            code: this.code,
            message: this.message,
            params: this.paramDescriptions
        }
    }

    /**
     * Interpolate message with params (simple {key} replacement).
     */
    private createMessage(params?: object): string {
        if (!params) return this.message;
        return this.message.replace(/\{(\w+)\}/g, (_, key) =>
            String((params as Record<string, unknown>)[key] ?? `{${key}}`)
        )
    }

    /**
     * Convert to localized JSON for network transport.
     * Uses TypeLocalizer if available, falls back to simple interpolation.
     */
    public toLocalizedJSON(path: string, params?: object, value?: unknown): ValidationIssueJson {
        let json: ValidationIssueJson = {
            path: path,
            code: this.code,
            message: this.createMessage(params),
            params: params,
            value: value
        };
        GGIssueKey.localizer?.(json);
        return json;
    }
}

/**
 * Serializable validation issue for network transport.
 * This is what gets sent over the wire in VALIDATION_ERROR responses.
 */
export interface ValidationIssueJson {
    path: string;
    code: string;
    message: string;  // Rendered with params, localized if localizer is available
    params?: object;
    value?: unknown;
    usedLanguage?: string;  // Language actually used (set by localizer)
    expectedLanguage?: string;  // Language requested (set by localizer)
}