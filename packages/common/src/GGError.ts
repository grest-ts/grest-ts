/**
 * Context for constructing GGError instances
 * This is ONLY an input parameter - not stored on the error object
 * All fields become direct readonly properties on GGError
 */
export interface GGErrorContext {
    displayMessage?: string;
    debugMessage?: string;
    debugData?: any
    originalError?: GGError | Error | string | unknown;

    // Internal: Used only for deserialization from JSON
    refId?: string;
    timestamp?: number;
}

/**
 * These values are only returned when running tests or locally.
 */
export interface GGErrorDebugMessage {
    debugMessage?: string;
    debugData?: any
    originalError?: GGErrorDebugMessage | Error | string | unknown;
}

export class GGError extends Error {

    public readonly refId: string;
    public readonly timestamp: number;
    public readonly displayMessage?: string;
    public readonly debugMessage?: string;
    public readonly debugData?: any;
    public readonly originalError?: GGError | Error | string | unknown;

    constructor(message: string, context?: GGErrorContext | Error) {

        if (context instanceof Error) {
            context = {
                originalError: context
            }
        } else if (!context) {
            context = {};
        }

        let refId: string;
        let timestamp: number;
        if (context.originalError instanceof GGError) {
            refId = context.originalError.refId;
            timestamp = context.originalError.timestamp;
        } else {
            refId = context.refId ?? "ERR_REF_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
            timestamp = context.timestamp ?? Date.now();
        }

        super(message + " {" + refId + "} " + (context?.displayMessage ? ": " + context?.displayMessage : ""));
        this.refId = refId
        this.timestamp = timestamp
        this.displayMessage = context.displayMessage;
        this.debugMessage = context.debugMessage;
        this.debugData = context.debugData;
        this.originalError = context.originalError;
    }

    public static fromUnknown(error: unknown): GGError {
        if (error instanceof GGError) {
            return error;
        } else if (error instanceof Error) {
            return new GGError(error.message, error);
        } else {
            return new GGError("Unknown", {debugData: error});
        }
    }
}

