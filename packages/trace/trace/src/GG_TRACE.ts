import {GGContextKey} from "@grest-ts/context";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";

const IsTraceContext = IsObject({
    traceId: IsString,
    traceTimestamp: IsNumber,
    parentSpanId: IsString.orUndefined,
    spanId: IsString,
    spanTimestamp: IsNumber
});
export type TraceContext = typeof IsTraceContext.infer;

export class GGContextTraceKey extends GGContextKey<TraceContext> {

    public init() {
        this.set(this.getNew());
    }

    public getNew(): TraceContext {
        const traceId = GGContextTraceKey.generateTraceId();
        const startTs = Date.now()
        return Object.freeze({
            traceId: traceId,
            traceTimestamp: startTs,
            parentSpanId: undefined,
            spanId: traceId,
            spanTimestamp: startTs
        })
    }

    public static generateTraceId(): string {
        if (typeof globalThis.crypto?.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }
        // Fallback for environments without crypto.randomUUID
        return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    }
}

export const GG_TRACE = new GGContextTraceKey('trace', IsTraceContext, {mutable: true});


