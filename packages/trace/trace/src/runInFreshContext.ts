import {GGContext} from "@grest-ts/context";
import {GG_TRACE, type TraceContext} from "./GG_TRACE";

/**
 * Runs one unit of work (a request, a job run, a timer, an event) in a fresh context with no parent, so it inherits
 * nothing another unit or the runtime set and what it sets reaches no one else. Its trace is new, or a child span of
 * `trace` when it continues one (an event's sender, the caller who asked for a job run).
 */
export function runInFreshContext<R>(name: string, fn: () => R, options: {strict?: boolean, trace?: TraceContext} = {}): R {
    return new GGContext(name, undefined, options.strict).run(() => {
        GG_TRACE.startSpan(options.trace);
        return fn();
    });
}
