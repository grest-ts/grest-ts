import {AsyncLocalStorage} from "node:async_hooks";
import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {GGLocator, GGLocatorScope} from "@grest-ts/locator";
import {GGLog} from "@grest-ts/logger";
import {GGDateShim} from "./GGDateShim";
import {outsideTestkitError} from "../utils/outsideTestkitError";

interface ScopeTimer {
    handle: NodeJS.Timeout
    fn: () => unknown
    ms: number
    interval: boolean
    dueAt: number
    ref: boolean
    armed?: NodeJS.Timeout
    created: Error
    cleared?: boolean
    id?: unknown
}

interface RawTimer {
    /** Formatted only when the clock moves past it; undefined once known not to be app code. */
    created?: Error
    ms: number
    interval: boolean
    dueAt: number
    realDueAt: number
    id?: unknown
}

interface NativeTimers {
    setTimeout: typeof globalThis.setTimeout
    setInterval: typeof globalThis.setInterval
    clearTimeout: typeof globalThis.clearTimeout
    clearInterval: typeof globalThis.clearInterval
}

interface TimerShim {
    native: NativeTimers
    scopeTimers: Map<unknown, ScopeTimer>
    /** Every scope timer by handle, fired ones included: clearing one that fired stops refresh() reviving it. */
    allScopeTimers: WeakMap<object, ScopeTimer>
    rawTimers: Map<unknown, RawTimer>
    /** Numeric ids handed out by a tracked handle's Symbol.toPrimitive, to its handle. */
    ids: Map<unknown, unknown>
    /** The scope timers pending at the last clock change; only these can fire in the fireDue that follows it. */
    barrier?: Set<ScopeTimer>
    warnedSites: Set<string>
    creatingScopeTimer: boolean
}

const KEY = Symbol.for("@grest-ts/testkit:GGTimerShim");
const PATCHED = Symbol.for("@grest-ts/testkit:GGTimerShim.patched");
const slot = globalThis as unknown as Record<symbol, TimerShim | undefined>;

const TIMEOUT_MAX = 2 ** 31 - 1;
const RAW_TIMER_MS = Number(process.env.GG_TEST_CLOCK_RAW_TIMER_MS ?? 1000);
const STACK_FRAMES = 30;
const LOG_CONTEXT = {name: "GGTestClock"};
const noop = () => {};

/**
 * Scope timers (GGLocator/GGLocatorScope setTimeout/setInterval) follow the test clock. Other timers stay native and
 * real-time; the global set/clear functions are wrapped only to see cancellations and long app timers.
 */
export function installTimerShim(): void {
    let shim = slot[KEY];
    if (!shim) {
        const native: NativeTimers = {
            setTimeout: globalThis.setTimeout,
            setInterval: globalThis.setInterval,
            clearTimeout: globalThis.clearTimeout,
            clearInterval: globalThis.clearInterval,
        };
        shim = slot[KEY] = {native, scopeTimers: new Map(), allScopeTimers: new WeakMap(), rawTimers: new Map(), ids: new Map(), warnedSites: new Set(), creatingScopeTimer: false};
        globalThis.setTimeout = wrapSet(shim, native.setTimeout, false) as typeof globalThis.setTimeout;
        globalThis.setInterval = wrapSet(shim, native.setInterval, true) as typeof globalThis.setInterval;
        globalThis.clearTimeout = wrapClear(shim, native.clearTimeout);
        globalThis.clearInterval = wrapClear(shim, native.clearInterval);
    }
    patchScope(shim);
    patchLocator(shim);
}

// Outside a scope GGLocator falls back to a plain timer, for CLIs; in a test that is a timer gone astray.
function patchLocator(shim: TimerShim): void {
    const locator = GGLocator as typeof GGLocator & {[PATCHED]?: boolean};
    if (locator[PATCHED]) return;
    locator[PATCHED] = true;
    const {setTimeout, setInterval} = GGLocator;
    const warnOutsideScope = (fn: string) => {
        if (GGLocator.tryGetScope()) return;
        const site = appSite(captureStack().stack);
        if (!site || shim.warnedSites.has(site)) return;
        shim.warnedSites.add(site);
        GGLog.warn(LOG_CONTEXT, `GGLocator.${fn} was called outside a GGLocatorScope: it's a plain timer that its runtime won't clear when it stops and GGTest.clock won't move. Call it from code that runs in the runtime's scope. Set at: ${site}`);
    };
    locator.setTimeout = function (fn, ms) {
        warnOutsideScope("setTimeout");
        return setTimeout.call(this, fn, ms);
    };
    locator.setInterval = function (fn, ms) {
        warnOutsideScope("setInterval");
        return setInterval.call(this, fn, ms);
    };
}

// Per class, not per slot: a module re-evaluated by another vitest project brings its own GGLocatorScope.
function patchScope(shim: TimerShim): void {
    const proto = GGLocatorScope.prototype as GGLocatorScope & {[PATCHED]?: boolean};
    if (proto[PATCHED]) return;
    proto[PATCHED] = true;
    const {setTimeout, setInterval} = proto;
    // The original methods reach the wrapped global, which turns the call into a scope timer. Under
    // vi.useFakeTimers the global is vitest's, and scope timers stay vitest-faked as before.
    const creating = <T>(create: () => T): T => {
        shim.creatingScopeTimer = true;
        try {
            return create();
        } finally {
            shim.creatingScopeTimer = false;
        }
    };
    proto.setTimeout = function (this: GGLocatorScope, fn, ms) {
        return creating(() => setTimeout.call(this, fn, ms)) as NodeJS.Timeout;
    };
    proto.setInterval = function (this: GGLocatorScope, fn, ms) {
        return creating(() => setInterval.call(this, fn, ms)) as NodeJS.Timeout;
    };
}

function wrapSet(shim: TimerShim, nativeSet: (...args: any[]) => NodeJS.Timeout, interval: boolean) {
    const wrapped = function (cb: (...args: any[]) => unknown, ms?: number, ...args: unknown[]): NodeJS.Timeout {
        if (shim.creatingScopeTimer) {
            shim.creatingScopeTimer = false;
            return addScopeTimer(shim, cb, ms, interval);
        }
        const delay = Number(ms) || 0;
        if (typeof cb !== "function" || delay < RAW_TIMER_MS) return nativeSet(cb, ms, ...args);
        const raw: RawTimer = {created: captureStack(), ms: delay, interval, dueAt: Date.now() + delay, realDueAt: performance.now() + delay};
        const handle = nativeSet(function (this: unknown, ...cbArgs: unknown[]) {
            if (interval) {
                raw.dueAt = Date.now() + delay;
                raw.realDueAt = performance.now() + delay;
            } else {
                dropRaw(shim, handle);
            }
            return cb.apply(this, cbArgs);
        }, ms, ...args);
        const {close, [Symbol.dispose]: dispose} = Object.getPrototypeOf(handle);
        Object.defineProperties(handle, {
            close: {configurable: true, value: () => { dropRaw(shim, handle); return close.call(handle); }},
            [Symbol.dispose]: {configurable: true, value: () => { dropRaw(shim, handle); dispose.call(handle); }},
        });
        trackId(shim, handle, raw);
        shim.rawTimers.set(handle, raw);
        return handle;
    };
    for (const key of Reflect.ownKeys(nativeSet)) {
        if (!Object.hasOwn(wrapped, key)) Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(nativeSet, key)!);
    }
    return wrapped;
}

function wrapClear(shim: TimerShim, nativeClear: (handle?: any) => void) {
    return function (handle?: any): void {
        if (handle !== undefined && handle !== null) {
            const key = typeof handle === "object" ? handle : shim.ids.get(handle) ?? handle;
            const timer = typeof key === "object" ? shim.allScopeTimers.get(key) : undefined;
            if (timer) clear(shim, timer);
            dropRaw(shim, key);
        }
        nativeClear(handle);
    };
}

/** `clearTimeout(+handle)` must find the timer: remember the id the handle's Symbol.toPrimitive gives out. */
function trackId(shim: TimerShim, handle: NodeJS.Timeout, entry: {id?: unknown}): void {
    const toPrimitive = (handle as any)[Symbol.toPrimitive];
    Object.defineProperty(handle, Symbol.toPrimitive, {configurable: true, value: () => {
        const id = toPrimitive.call(handle);
        entry.id = id;
        shim.ids.set(id, handle);
        return id;
    }});
}

function dropRaw(shim: TimerShim, handle: unknown): void {
    const raw = shim.rawTimers.get(handle);
    if (!raw) return;
    shim.rawTimers.delete(handle);
    if (raw.id !== undefined) shim.ids.delete(raw.id);
}

function captureStack(): Error {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = STACK_FRAMES;
    try {
        return new Error();
    } finally {
        Error.stackTraceLimit = limit;
    }
}

function addScopeTimer(shim: TimerShim, fn: () => unknown, ms: number | undefined, interval: boolean): NodeJS.Timeout {
    const delay = Number(ms) >= 1 && Number(ms) <= TIMEOUT_MAX ? Number(ms) : 1;
    // A real Timeout that never fires; the firing timer underneath is re-armed whenever the clock changes.
    const handle = shim.native.setTimeout(noop, 0);
    shim.native.clearTimeout(handle);
    // fireDue and re-arming call it from the clock change's async context; run it in its creator's, as Node would.
    const inCreatorContext = AsyncLocalStorage.snapshot();
    const timer: ScopeTimer = {handle, fn: () => inCreatorContext(fn), ms: delay, interval, dueAt: Date.now() + delay, ref: true, created: captureStack()};
    Object.defineProperties(handle, {
        ref: {configurable: true, value: () => { timer.ref = true; timer.armed?.ref(); return handle; }},
        unref: {configurable: true, value: () => { timer.ref = false; timer.armed?.unref(); return handle; }},
        hasRef: {configurable: true, value: () => timer.ref},
        // Like Node: restarts a pending timer, and re-activates a timeout that already fired, but not a cleared one.
        refresh: {configurable: true, value: () => {
            if (timer.cleared) return handle;
            timer.dueAt = Date.now() + timer.ms;
            shim.scopeTimers.set(handle, timer);
            arm(shim, timer);
            return handle;
        }},
        close: {configurable: true, value: () => { clear(shim, timer); return handle; }},
        [Symbol.dispose]: {configurable: true, value: () => clear(shim, timer)},
    });
    trackId(shim, handle, timer);
    shim.allScopeTimers.set(handle, timer);
    shim.scopeTimers.set(handle, timer);
    arm(shim, timer);
    return handle;
}

/** `due`: also arm a timer that is already due, to fire right away. Otherwise it waits for fireDue. */
function arm(shim: TimerShim, timer: ScopeTimer, due = false): void {
    disarm(shim, timer);
    if (GGDateShim.getState().stoppedAt !== undefined) return;
    const ms = timer.dueAt - Date.now();
    if (ms <= 0 && !due) return;
    timer.armed = shim.native.setTimeout(() => {
        timer.armed = undefined;
        // Past TIMEOUT_MAX the timer is armed for the max and wakes early.
        if (Date.now() < timer.dueAt) return arm(shim, timer, true);
        settle(shim, timer);
        timer.fn();
    }, Math.min(Math.max(ms, 0), TIMEOUT_MAX));
    if (!timer.ref) timer.armed.unref();
}

function disarm(shim: TimerShim, timer: ScopeTimer): void {
    if (timer.armed) shim.native.clearTimeout(timer.armed);
    timer.armed = undefined;
}

function clear(shim: TimerShim, timer: ScopeTimer): void {
    timer.cleared = true;
    cancel(shim, timer);
}

function cancel(shim: TimerShim, timer: ScopeTimer): void {
    disarm(shim, timer);
    if (shim.scopeTimers.get(timer.handle) === timer) shim.scopeTimers.delete(timer.handle);
    if (timer.cleared && timer.id !== undefined) shim.ids.delete(timer.id);
}

/** Before its callback runs: a timeout is done, an interval continues from now. */
function settle(shim: TimerShim, timer: ScopeTimer): void {
    if (timer.interval) {
        timer.dueAt = Date.now() + timer.ms;
        arm(shim, timer);
    } else {
        cancel(shim, timer);
    }
}

function getShim(): TimerShim {
    const shim = slot[KEY];
    if (!shim) throw outsideTestkitError("GGTest.clock (its timer shim)");
    return shim;
}

export const GGTimerShim = {

    /**
     * Re-arms every pending scope timer for the current clock state. Moved back, a timer waits at most its own delay
     * from now, not until its old due time.
     */
    rearm(): void {
        const shim = getShim();
        const now = Date.now();
        for (const timer of shim.scopeTimers.values()) {
            timer.dueAt = Math.min(timer.dueAt, now + timer.ms);
            arm(shim, timer);
        }
    },

    /** Marks the barrier of a clock change: the timers pending now are the ones the following fireDue may fire. */
    snapshot(): void {
        const shim = getShim();
        shim.barrier = new Set(shim.scopeTimers.values());
    },

    /** Raw-timer warnings are once per creation site; call per test file. */
    resetWarnings(): void {
        slot[KEY]?.warnedSites.clear();
    },

    /**
     * Starts, in due order, every scope timer of the last barrier that is due by `target`, then waits for all the
     * promises they return. Rejects with their errors, or when one is still pending after `timeoutMs`. Warns about app
     * raw timers the clock has moved past.
     */
    async fireDue(target: number, timeoutMs: number): Promise<void> {
        const shim = getShim();
        const pending = shim.barrier ?? new Set(shim.scopeTimers.values());
        shim.barrier = undefined;
        warnRawTimers(shim, target);
        const due = [...pending].filter(t => t.dueAt <= target).sort((a, b) => a.dueAt - b.dueAt);
        const runs: {timer: ScopeTimer, settled: boolean, done: Promise<unknown>}[] = [];
        for (const timer of due) {
            if (shim.scopeTimers.get(timer.handle) !== timer || timer.dueAt > target) continue;
            settle(shim, timer);
            const run = {timer, settled: false, done: new Promise(resolve => resolve(timer.fn()))};
            run.done = run.done.finally(() => { run.settled = true; });
            runs.push(run);
        }
        // Due after the target but before this isolate re-armed at the barrier: not armed yet.
        for (const timer of shim.scopeTimers.values()) {
            if (!timer.armed) arm(shim, timer, true);
        }
        if (runs.length === 0) return;
        let guard: NodeJS.Timeout | undefined;
        const stuck = new Promise<never>((_, reject) => {
            guard = shim.native.setTimeout(() => {
                const pendingRun = runs.find(r => !r.settled)!;
                reject(new Error(`GGTest.clock: a timer callback's promise hasn't settled after ${Math.round(timeoutMs)}ms. The timer was set at:\n${creationSite(pendingRun.timer.created)}`));
            }, timeoutMs);
        });
        let results: PromiseSettledResult<unknown>[];
        try {
            results = await Promise.race([Promise.allSettled(runs.map(r => r.done)), stuck]);
        } finally {
            shim.native.clearTimeout(guard);
        }
        throwAll(rejections(results));
    },
};

export function rejections(results: PromiseSettledResult<unknown>[]): unknown[] {
    return results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(r => r.reason);
}

class GGClockErrors extends AggregateError {}

/** Throws the one error as is, or several as one AggregateError; nested ones from other isolates' fireDue are flattened. */
export function throwAll(errors: unknown[]): void {
    const flat = errors.flatMap(e => e instanceof GGClockErrors ? e.errors : [e]);
    if (flat.length === 1) throw flat[0];
    if (flat.length > 1) throw new GGClockErrors(flat, `GGTest.clock: ${flat.map(e => String((e as Error)?.message ?? e).replace(/^GGTest\.clock: /, "")).join("; ")}`);
}

function warnRawTimers(shim: TimerShim, target: number): void {
    const realNow = performance.now();
    for (const raw of shim.rawTimers.values()) {
        if (!raw.created || raw.dueAt > target || raw.realDueAt <= realNow) continue;
        const site = appSite(raw.created.stack);
        if (!site) {
            raw.created = undefined;
            continue;
        }
        if (shim.warnedSites.has(site)) continue;
        shim.warnedSites.add(site);
        const fn = raw.interval ? "setInterval" : "setTimeout";
        GGLog.warn(LOG_CONTEXT, `GGTest.clock moved past a raw ${fn}(…, ${raw.ms}) that still runs on real time. If it should follow the clock, use GGLocator.${fn}. Set at: ${site}`);
    }
}

function creationSite(created: Error): string {
    return (created.stack ?? "").split("\n").slice(1)
        .filter(line => !/node:|[\\/]testkit[\\/]src[\\/]clock[\\/]|GGLocatorScope|GGLocator\./.test(line))
        .slice(0, 5).join("\n");
}

const FRAME_PATH = /\(?((?:file:\/\/)?[^\s()]+?):\d+:\d+\)?$/;
const frameworkDirs = new Map<string, boolean>();

/** The first stack frame outside node internals, node_modules and @grest-ts packages; undefined when there is none. */
function appSite(stack: string | undefined): string | undefined {
    for (const line of (stack ?? "").split("\n").slice(1)) {
        const match = FRAME_PATH.exec(line.trim());
        if (!match) continue;
        let file = match[1];
        if (file.startsWith("node:") || file.includes("/node_modules/") || file.includes("\\node_modules\\")) continue;
        if (file.startsWith("file:")) file = fileURLToPath(file);
        if (isFrameworkDir(dirname(file))) continue;
        return line.trim().replace(/^at /, "");
    }
    return undefined;
}

function isFrameworkDir(dir: string): boolean {
    const known = frameworkDirs.get(dir);
    if (known !== undefined) return known;
    let result = false;
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
        try {
            result = String(JSON.parse(readFileSync(pkg, "utf8")).name ?? "").startsWith("@grest-ts/");
        } catch {
            result = false;
        }
    } else if (dirname(dir) !== dir) {
        result = isFrameworkDir(dirname(dir));
    }
    frameworkDirs.set(dir, result);
    return result;
}
