import type http from "http";
import type {GGHttpRequest, GGHttpTransportMiddleware} from "@grest-ts/http";
import {GG_TRACE, GGContextTraceKey} from "@grest-ts/trace";

const HEADER_TRACE_ID = "x-b3-traceid"       // Root trace ID for the entire request chain
const HEADER_SPAN_ID = "x-b3-spanid"             // Current span ID (becomes parent for children)
const HEADER_PARENT_SPAN_ID = "x-b3-parentspanid" // Parent span ID
const HEADER_ROOT_START_TS = "x-root-start-ts"    // Timestamp when root context was created

/**
 * Trace effect - provides distributed tracing context.
 * Extracts B3/Zipkin headers and generates trace IDs.
 */
export const GGTracingMiddleware: GGHttpTransportMiddleware = {

    headers: [HEADER_TRACE_ID, HEADER_SPAN_ID, HEADER_PARENT_SPAN_ID, HEADER_ROOT_START_TS],
    responseHeaders: [],

    updateRequest(req: GGHttpRequest): void {
        const trace = GG_TRACE.get()
        if (trace?.traceId) req.headers[HEADER_TRACE_ID] = trace.traceId;
        if (trace?.parentSpanId) req.headers[HEADER_PARENT_SPAN_ID] = trace.parentSpanId;
        if (trace?.spanId) req.headers[HEADER_SPAN_ID] = trace.spanId;
        if (trace?.traceTimestamp) req.headers[HEADER_ROOT_START_TS] = String(trace.traceTimestamp);
    },

    parseRequest(req: http.IncomingMessage): void {
        const headers = req.headers as Record<string, string | undefined>;
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
