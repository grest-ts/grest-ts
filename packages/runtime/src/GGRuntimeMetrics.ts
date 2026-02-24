import {GGMetrics} from "@grest-ts/metrics";
import {GGGaugeKey} from "@grest-ts/metrics";
import {GGLazyGaugeKey} from "@grest-ts/metrics";

/**
 * Runtime-level metrics for process monitoring.
 * Uses lazy gauges for values that should be computed on read.
 */
export const GGRuntimeMetrics = GGMetrics.define('/runtime/', () => ({

    /**
     * Unix timestamp (in seconds) when the process started.
     * Set once at process startup. Uptime = now - startTime.
     */
    startTime: new GGGaugeKey<{}>('start_time_seconds', {
        help: 'Unix timestamp when the process started'
    }),

    memory: {
        /**
         * V8 heap memory currently in use (bytes).
         */
        heapUsed: new GGLazyGaugeKey('memory_heap_used_bytes', {
            help: 'V8 heap memory used in bytes',
            getValue: () => process.memoryUsage().heapUsed
        }),

        /**
         * Total V8 heap memory allocated (bytes).
         */
        heapTotal: new GGLazyGaugeKey('memory_heap_total_bytes', {
            help: 'V8 heap memory total in bytes',
            getValue: () => process.memoryUsage().heapTotal
        }),

        /**
         * Resident Set Size - total memory allocated for the process (bytes).
         */
        rss: new GGLazyGaugeKey('memory_rss_bytes', {
            help: 'Resident Set Size in bytes',
            getValue: () => process.memoryUsage().rss
        }),

        /**
         * Memory used by C++ objects bound to JavaScript objects managed by V8.
         */
        external: new GGLazyGaugeKey('memory_external_bytes', {
            help: 'V8 external memory in bytes',
            getValue: () => process.memoryUsage().external
        }),

        /**
         * Memory allocated for ArrayBuffers and SharedArrayBuffers.
         */
        arrayBuffers: new GGLazyGaugeKey('memory_array_buffers_bytes', {
            help: 'Memory allocated for ArrayBuffers in bytes',
            getValue: () => process.memoryUsage().arrayBuffers
        }),
    },

    /**
     * Number of active handles (timers, sockets, etc.) keeping the event loop alive.
     */
    activeHandles: new GGLazyGaugeKey('active_handles', {
        help: 'Number of active handles keeping the event loop alive',
        getValue: () => (process as any)._getActiveHandles?.()?.length ?? 0
    }),

    /**
     * Number of active requests (pending async operations).
     */
    activeRequests: new GGLazyGaugeKey('active_requests', {
        help: 'Number of active async requests',
        getValue: () => (process as any)._getActiveRequests?.()?.length ?? 0
    }),

}));

/**
 * Initialize runtime metrics - sets the start time.
 * Should be called once at process/runtime startup.
 */
export function initRuntimeMetrics(): void {
    GGRuntimeMetrics.startTime.set(Math.floor(Date.now() / 1000));
}
