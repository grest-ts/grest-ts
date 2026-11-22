import {GGContext, GGContextStore} from "@grest-ts/context"
import {GG_TRACE, runInFreshContext, type TraceContext} from "@grest-ts/trace"

/** A run gets a fresh context with no parent, so it inherits nothing and what it sets reaches nothing else; what
 *  `getDataSet` sets there, its rows see. Its trace is new, or a span of `caller`'s for a run someone asked for. */
export function inJobRunContext<T>(fn: () => Promise<T>, caller?: TraceContext): Promise<T> {
    return runInFreshContext("JOB", fn, {trace: caller})
}

/** A row is a child span of its run, in its own context: what one row sets the next one never sees. */
export function inJobRowContext<T>(fn: () => Promise<T>): Promise<T> {
    return new GGContext("JOB-ROW", GGContextStore.tryGetContext()).run(() => {
        GG_TRACE.startSpan()
        return fn()
    })
}
