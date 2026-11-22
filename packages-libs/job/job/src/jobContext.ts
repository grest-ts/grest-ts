import {GGContext, GGContextStore} from "@grest-ts/context"
import {GG_TRACE} from "@grest-ts/trace"

/** A run gets a fresh context and trace with no parent, so it inherits nothing and what it sets reaches nothing else.
 *  What `getDataSet` sets there, its rows see. */
export function inJobRunContext<T>(fn: () => Promise<T>): Promise<T> {
    return new GGContext("JOB").run(() => {
        GG_TRACE.init()
        return fn()
    })
}

/** A row is a child span of its run, in its own context: what one row sets the next one never sees. */
export function inJobRowContext<T>(fn: () => Promise<T>): Promise<T> {
    return new GGContext("JOB-ROW", GGContextStore.tryGetContext()).run(() => {
        GG_TRACE.startSpan()
        return fn()
    })
}
