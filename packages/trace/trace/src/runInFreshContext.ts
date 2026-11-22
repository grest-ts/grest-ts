import {GGContext} from "@grest-ts/context";
import {GG_TRACE, type TraceContext} from "./GG_TRACE";

/**
 * Runs one unit of work (a request, a job run, a timer, an event) in a fresh context with no parent, so it inherits
 * nothing another unit or the runtime set and what it sets reaches no one else. Its trace is new, or a child span of
 * `trace` when it continues one (an event's sender, the caller who asked for a job run). It is strict: a key that isn't
 * `mutable` can be set once, so two parts of the same unit can't silently overwrite each other's value.
 */
export function runInFreshContext<R>(name: string, fn: () => R, trace?: TraceContext): R {
    return new GGContext(name, undefined, {strict: true}).run(() => {
        GG_TRACE.startSpan(trace);
        return fn();
    });
}
