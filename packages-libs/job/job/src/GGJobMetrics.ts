import {GGCounterKey, GGGaugeKey, GGMetrics} from "@grest-ts/metrics"

export const GGJobMetrics = GGMetrics.define("/job/", () => ({
    runs: new GGCounterKey<{job: string}>("runs_total", {
        help: "Runs started (a `oneInstance` job counts only the runs that took its lock)",
        labelNames: ["job"],
    }),
    runDuration: new GGCounterKey<{job: string}>("run_duration_ms", {
        help: "Total run duration in milliseconds",
        labelNames: ["job"],
    }),
    rows: new GGCounterKey<{job: string, result: "OK" | "ERROR"}>("rows_total", {
        help: "Rows processed",
        labelNames: ["job", "result"],
        groupBy: {labels: ["job"]},
    }),
    rowsInFlight: new GGGaugeKey<{job: string}>("rows_in_flight", {
        help: "Rows being processed right now",
        labelNames: ["job"],
    }),
    lockLost: new GGCounterKey<{job: string}>("lock_lost_total", {
        help: "Runs aborted because their lock was lost",
        labelNames: ["job"],
    }),
}))
