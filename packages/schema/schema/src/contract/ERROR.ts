import {GGSchema} from "../GGSchema";
import {OK} from "./OK";

export interface ERROR_JSON<Type extends string = string, Data = any> {
    success: false,
    type: Type,
    data: Data,
    statusCode?: number,
    context?: GGErrorData
}

export type ANY_ERROR = ERROR<any, any>

export type ANY_RESULT = OK<any> | ANY_ERROR

export interface GGErrorData {
    /**
     * This message survives network etc calls. Users can see it.
     */
    displayMessage?: string
    timestamp?: number
    /**
     * unique identifier for the error. Randomly generated, don't set it if you don't have to.
     */
    ref?: string
}

/**
 * These items are hidden when crossing network boundaries. Useful for internal logs that can be matched using REF.
 */
export interface GGDebugData {
    debugMessage?: string
    debugData?: any
    originalError?: ERROR<any, any> | Error | string | unknown
}

export interface GGErrorTextConfig {
    /** Separator between the title line and the data block; may carry styling (default `"\n\t"`). */
    dataSeparator?: string
    /** Include the stack trace (default true). */
    stack?: boolean
    /** Include debug data + original error blocks (default true). */
    debug?: boolean
}

function tabLines(text: string): string {
    return text.split("\n").join("\n\t")
}

interface ERROR_CLASS<Type extends string, Data> {
    /**
     * Can be any string, it will be used as union discriminator
     */
    readonly TYPE: Type
    /**
     * Http status code for this error. This is for convenience, as for most cases we want to define http error code and we mostly tend to use http for our API-s. Ignored for other types.
     */
    readonly STATUS_CODE: number
    /**
     * Get type of this error.
     */
    readonly infer: ERROR<Type, Data>
    /**
     * Schema data is used to validate the public Data if this error has data.
     */
    readonly schema?: GGSchema<Data> | undefined

    /**
     * Checks if any data is an instanceof your defined error.
     */
    is(err: unknown): err is ERROR<Type, Data>
}

export interface ERR_CLASS<Type extends string> extends ERROR_CLASS<Type, never> {
    new(context?: GGErrorData & GGDebugData | ERROR<any, any>): ERROR<Type, never>
}

export interface ERR_CLASS_DATA<Type extends string, Data> extends ERROR_CLASS<Type, Data> {
    new(data: Data, context?: GGErrorData & GGDebugData | ERROR<any, any>): ERROR<Type, Data>
}

export type ANY_ERROR_CLS = ERR_CLASS<any> | ERR_CLASS_DATA<any, any>

const ERRORS_REGISTRY: Map<string, ERROR<string, unknown>> = new Map();

export abstract class ERROR<Type extends string, Data> extends Error {

    public readonly success: false = false
    public readonly type: Type
    public readonly statusCode: number
    public readonly data: Data

    public readonly context?: GGErrorData
    readonly #debugContext?: GGDebugData

    protected constructor(type: Type, statusCode: number, data: Data, context?: GGErrorData & GGDebugData) {
        super(type)
        this.type = type
        this.statusCode = statusCode
        this.data = data
        this.context = {
            displayMessage: context?.displayMessage,
            timestamp: context?.timestamp ?? Date.now(),
            ref: context?.ref
                ?? (context && context.originalError instanceof ERROR ? context.originalError.context?.ref : undefined)
                ?? "ERR_REF_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
        }
        this.#debugContext = {
            debugMessage: context?.debugMessage,
            debugData: context?.debugData,
            originalError: context?.originalError
        }
        Object.freeze(this)
        Object.freeze(this.context)
        Object.freeze(this.#debugContext)
    }

    public getDebugContext(): GGDebugData | undefined {
        return this.#debugContext
    }

    public hasDebugContext(): boolean {
        const d = this.#debugContext
        return !!(d && (d.debugMessage || d.debugData || d.originalError))
    }

    public static define<Type extends string>(type: Type, statusCode: number): ERR_CLASS<Type>
    public static define<Type extends string, Data>(type: Type, statusCode: number, schema: GGSchema<Data>): ERR_CLASS_DATA<Type, Data>
    public static define(type: string, statusCode: number, schema?: GGSchema<any>): any {
        // Return existing class if already defined (idempotent behavior for tests)
        const existing = ERRORS_REGISTRY.get(type)
        if (existing) return existing
        if (!type.match(/^[A-Z][A-Za-z0-9_]*$/)) throw new Error(`Error type "${type}" is not valid! Must match /^[A-Z][A-Za-z0-9_]*$/`)
        if (statusCode < 100 || statusCode >= 600) throw new Error(`Error status code "${statusCode}" is not valid! Must be between 100 and 599 (inclusive)`)
        const code = statusCode
        let cls: any
        if (schema) {
            cls = class extends ERROR<any, any> {
                static readonly TYPE = type
                static readonly STATUS_CODE = code
                static readonly schema = schema
                declare static readonly infer: any

                constructor(data: any, context?: GGErrorData & GGDebugData) {
                    super(type, code, data, context)
                }

                static is(err: unknown): err is ERROR<any, any> {
                    return err instanceof cls
                }
            }
        } else {
            cls = class extends ERROR<any, never> {
                static readonly TYPE = type
                static readonly STATUS_CODE = code
                declare static readonly infer: any

                constructor(context?: GGErrorData & GGDebugData) {
                    super(type, code, undefined as never, context)
                }

                static is(err: unknown): err is ERROR<any, any> {
                    return err instanceof cls
                }
            }
        }
        Object.defineProperty(cls, 'name', {value: type, configurable: true})
        Object.freeze(cls)
        ERRORS_REGISTRY.set(type, cls)
        return cls;
    }

    public static badRequest<Type extends string, Data = never>(type: Type): ERR_CLASS<Type>
    public static badRequest<Type extends string, Data>(type: Type, schema: GGSchema<Data>): ERR_CLASS_DATA<Type, Data>
    public static badRequest(type: string, schema?: GGSchema<any>): any {
        return schema ? ERROR.define(type, 400, schema) : ERROR.define(type, 400)
    }

    /**
     * Full default rendering for logs and wrapped error messages:
     * `TYPE: displayMessage debugMessage` title (parts present only when set),
     * data after `dataSeparator`, then stack trace, debug data, and the
     * original error recursively. Carries no styling of its own; the console
     * logger injects its colors via the title prefix and `dataSeparator`.
     */
    public toText(config?: GGErrorTextConfig): string {
        let text: string = this.type
        if (this.context?.displayMessage) text += ": " + this.context.displayMessage
        if (this.#debugContext?.debugMessage) text += " " + this.#debugContext.debugMessage

        if (this.data !== undefined && this.data !== null) {
            text += config?.dataSeparator ?? "\n\t"
            // Matched by type string: VALIDATION_ERROR is defined in standardErrors.ts, which imports this file.
            if (this.type === "VALIDATION_ERROR" && Array.isArray(this.data)) {
                const issues = this.data as {path?: string, message?: string}[]
                const texts = issues.slice(0, 10).map(i => (i.path ? i.path + ": " : "") + i.message)
                if (issues.length > 10) texts.push("+" + (issues.length - 10) + " more")
                text += texts.join("\n\t")
            } else {
                try {
                    text += JSON.stringify(this.data)
                } catch {
                    text += String(this.data)
                }
            }
        }

        if (config?.stack !== false && this.stack) {
            const stackLines = this.stack.split("\n")
            stackLines.shift()
            text += "\n" + stackLines.join("\n")
        }
        if (config?.debug !== false) {
            const debug = this.#debugContext
            if (debug?.debugData) text += "\n\tDebug data: " + tabLines(JSON.stringify(debug.debugData, null, 2))
            if (debug?.originalError) text += "\n\tOriginal error: " + tabLines(ERROR.anyToText(debug.originalError, config))
        }
        return text
    }

    /**
     * Render any thrown value through the same default formatting:
     * typed errors via toText(), plain errors via their stack, the rest stringified.
     */
    public static anyToText(err: unknown, config?: GGErrorTextConfig): string {
        if (err instanceof ERROR) return err.toText(config)
        if (err instanceof Error) return (config?.stack !== false ? err.stack : undefined) ?? err.message
        return String(err)
    }

    public toJSON(): ERROR_JSON<Type, Data> {
        return {
            success: this.success,
            type: this.type,
            data: this.data,
            statusCode: this.statusCode,
            context: this.context ? {
                displayMessage: this.context?.displayMessage,
                timestamp: this.context?.timestamp,
                ref: this.context?.ref
            } : undefined
        }
    }

    /**
     * Check if a value is an ERROR JSON response
     */
    public static isJson(value: unknown): value is ERROR_JSON<string, unknown> {
        return typeof value === "object"
            && value !== null
            && "success" in value
            && value.success === false
            && "type" in value
            && typeof value.type === "string"
    }

    public static fromUnknown<E extends ERROR<string, unknown>>(error: E): 0 extends (1 & E) ? ERROR<string, unknown> : E;
    public static fromUnknown(error: unknown): typeof SERVER_ERROR.infer;
    public static fromUnknown(error: unknown): any {
        if (error instanceof ERROR) {
            return error;
        } else if (error instanceof Error) {
            return new SERVER_ERROR({originalError: error});
        } else if (typeof error === "function" && "TYPE" in error && "STATUS_CODE" in error) {
            // Error class was thrown instead of instance
            return new SERVER_ERROR({debugMessage: "Tried to create error from error class! You should throw an instance, not class! (You should do: throw new " + (error as any).TYPE + "(...))!",});
        } else {
            return new SERVER_ERROR({debugData: error});
        }
    }
}

export const SERVER_ERROR = ERROR.define("SERVER_ERROR", 500)
