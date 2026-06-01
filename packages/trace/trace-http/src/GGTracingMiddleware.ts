import type {GGInbound, GGOutbound, GGTransportMiddleware} from "@grest-ts/context";
import {IsString} from "@grest-ts/schema";
import {GG_TRACE, GGContextTraceKey} from "@grest-ts/trace";

const HEADER_TRACE_ID = "x-b3-traceid"       // Root trace ID for the entire request chain
const HEADER_SPAN_ID = "x-b3-spanid"             // Current span ID (becomes parent for children)
const HEADER_PARENT_SPAN_ID = "x-b3-parentspanid" // Parent span ID
const HEADER_ROOT_START_TS = "x-root-start-ts"    // Timestamp when root context was created

/**
 * Trace effect - provides distributed tracing context.
 * Extracts B3/Zipkin headers and generates trace IDs.
 */
export const GGTracingMiddleware: GGTransportMiddleware = {

    headers: {
        [HEADER_TRACE_ID]:       IsString.orUndefined.docs({description: "Root trace ID for the entire request chain"}),
        [HEADER_SPAN_ID]:        IsString.orUndefined.docs({description: "Current span ID (becomes parent for children)"}),
        [HEADER_PARENT_SPAN_ID]: IsString.orUndefined.docs({description: "Parent span ID"}),
        [HEADER_ROOT_START_TS]:  IsString.orUndefined.docs({description: "Timestamp (ms) when the root context was created"}),
    },

    update(outbound: GGOutbound): void {
        const trace = GG_TRACE.get()
        if (trace?.traceId) outbound.headers[HEADER_TRACE_ID] = trace.traceId;
        if (trace?.parentSpanId) outbound.headers[HEADER_PARENT_SPAN_ID] = trace.parentSpanId;
        if (trace?.spanId) outbound.headers[HEADER_SPAN_ID] = trace.spanId;
        if (trace?.traceTimestamp) outbound.headers[HEADER_ROOT_START_TS] = String(trace.traceTimestamp);
    },

    parse(inbound: GGInbound): void {
        const headers = inbound.headers;
        const currentSpanId = GGContextTraceKey.generateTraceId();
        const currentStartTs = Date.now();
        GG_TRACE.set(Object.freeze({
            traceId: headers[HEADER_TRACE_ID] ?? currentSpanId,
            traceTimestamp: headers[HEADER_ROOT_START_TS] ? Number(headers[HEADER_ROOT_START_TS]) : currentStartTs,
            spanId: currentSpanId,
            parentSpanId: headers[HEADER_SPAN_ID],
            spanTimestamp: currentStartTs
        }));
    }
};
