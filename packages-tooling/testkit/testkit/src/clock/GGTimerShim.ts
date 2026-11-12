import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {GGLocatorScope} from "@grest-ts/locator";
import {GGLog} from "@grest-ts/logger";
import {GGDateShim} from "./GGDateShim";

interface ScopeTimer {
    handle: NodeJS.Timeout
    fn: () => unknown
    ms: number
    interval: boolean
    dueAt: number
    ref: boolean
    armed?: NodeJS.Timeout
    created: Error
}

interface RawTimer {
    site: string
    ms: number
    interval: boolean
    dueAt: number
    realDueAt: number
    warned?: boolean
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
    rawTimers: Map<unknown, RawTimer>
    creatingScopeTimer: boolean
}

const KEY = Symbol.for("@grest-ts/testkit:GGTimerShim");
const PATCHED = Symbol.for("@grest-ts/testkit:GGTimerShim.patched");
const slot = globalThis as unknown as Record<symbol, TimerShim | undefined>;

const TIMEOUT_MAX = 2 ** 31 - 1;
const RAW_TIMER_MS = Number(process.env.GG_TEST_CLOCK_RAW_TIMER_MS ?? 1000);
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
        shim = slot[KEY] = {native, scopeTimers: new Map(), rawTimers: new Map(), creatingScopeTimer: false};
        globalThis.setTimeout = wrapSet(shim, native.setTimeout, false) as typeof globalThis.setTimeout;
        globalThis.setInterval = wrapSet(shim, native.setInterval, true) as typeof globalThis.setInterval;
        globalThis.clearTimeout = wrapClear(shim, native.clearTimeout);
        globalThis.clearInterval = wrapClear(shim, native.clearInterval);
    }
    patchScope(shim);
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
        if (typeof cb !== "function" || !(Number(ms) >= RAW_TIMER_MS)) return nativeSet(cb, ms, ...args);
        const site = appSite(new Error().stack);
        if (!site) return nativeSet(cb, ms, ...args);
        const delay = Number(ms);
        const raw: RawTimer = {site, ms: delay, interval, dueAt: Date.now() + delay, realDueAt: performance.now() + delay};
        const handle = nativeSet(function (this: unknown, ...cbArgs: unknown[]) {
            if (interval) {
                raw.dueAt = Date.now() + delay;
                raw.realDueAt = performance.now() + delay;
            } else {
                shim.rawTimers.delete(handle);
            }
            return cb.apply(this, cbArgs);
        }, ms, ...args);
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
            const timer = shim.scopeTimers.get(handle);
            if (timer) cancel(shim, timer);
            shim.rawTimers.delete(handle);
        }
        nativeClear(handle);
    };
}

function addScopeTimer(shim: TimerShim, fn: () => unknown, ms: number | undefined, interval: boolean): NodeJS.Timeout {
    const delay = Number(ms) >= 1 && Number(ms) <= TIMEOUT_MAX ? Number(ms) : 1;
    // A real Timeout that never fires; the firing timer underneath is re-armed whenever the clock changes.
    const handle = shim.native.setTimeout(noop, 0);
    shim.native.clearTimeout(handle);
    const timer: ScopeTimer = {handle, fn, ms: delay, interval, dueAt: Date.now() + delay, ref: true, created: new Error()};
    Object.defineProperties(handle, {
        ref: {configurable: true, value: () => { timer.ref = true; timer.armed?.ref(); return handle; }},
        unref: {configurable: true, value: () => { timer.ref = false; timer.armed?.unref(); return handle; }},
        hasRef: {configurable: true, value: () => timer.ref},
        refresh: {configurable: true, value: () => {
            if (shim.scopeTimers.get(handle) === timer) {
                timer.dueAt = Date.now() + timer.ms;
                arm(shim, timer);
            }
            return handle;
        }},
        close: {configurable: true, value: () => { cancel(shim, timer); return handle; }},
        [Symbol.dispose]: {configurable: true, value: () => cancel(shim, timer)},
    });
    shim.scopeTimers.set(handle, timer);
    arm(shim, timer);
    return handle;
}

function arm(shim: TimerShim, timer: ScopeTimer): void {
    disarm(shim, timer);
    if (GGDateShim.getState().stoppedAt !== undefined) return;
    const ms = timer.dueAt - Date.now();
    // Due already: the clock jumped, and fireDue runs it so the jump can wait for it.
    if (ms <= 0) return;
    timer.armed = shim.native.setTimeout(() => {
        timer.armed = undefined;
        settle(shim, timer);
        timer.fn();
    }, ms);
    if (!timer.ref) timer.armed.unref();
}

function disarm(shim: TimerShim, timer: ScopeTimer): void {
    if (timer.armed) shim.native.clearTimeout(timer.armed);
    timer.armed = undefined;
}

function cancel(shim: TimerShim, timer: ScopeTimer): void {
    disarm(shim, timer);
    if (shim.scopeTimers.get(timer.handle) === timer) shim.scopeTimers.delete(timer.handle);
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
    if (!shim) throw new Error("GGTest.clock: the timer shim is not installed. Add '@grest-ts/testkit-vitest' to vitest setupFiles.");
    return shim;
}

export const GGTimerShim = {

    /** Re-arms every pending scope timer for the current clock state. */
    rearm(): void {
        const shim = getShim();
        for (const timer of shim.scopeTimers.values()) arm(shim, timer);
    },

    /**
     * Fires, once and in due order, every scope timer pending now and due by now, then waits for the promises they
     * return. Warns about app raw timers the clock has moved past.
     */
    async fireDue(timeoutMs: number): Promise<void> {
        const shim = getShim();
        const now = Date.now();
        warnRawTimers(shim, now);
        const due = [...shim.scopeTimers.values()].filter(t => t.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
        const runs: {timer: ScopeTimer, settled: boolean, done: Promise<unknown>}[] = [];
        for (const timer of due) {
            if (shim.scopeTimers.get(timer.handle) !== timer) continue;
            settle(shim, timer);
            const run = {timer, settled: false, done: undefined as unknown as Promise<unknown>};
            try {
                run.done = Promise.resolve(timer.fn());
            } catch (err) {
                run.done = Promise.reject(err);
            }
            run.done = run.done.finally(() => { run.settled = true; });
            runs.push(run);
        }
        if (runs.length === 0) return;
        let guard: NodeJS.Timeout | undefined;
        const stuck = new Promise<never>((_, reject) => {
            guard = shim.native.setTimeout(() => {
                const pending = runs.find(r => !r.settled)!;
                reject(new Error(`GGTest.clock: a timer callback's promise hasn't settled after ${timeoutMs}ms. The timer was set at:\n${creationSite(pending.timer.created)}`));
            }, timeoutMs);
        });
        try {
            await Promise.race([Promise.all(runs.map(r => r.done)), stuck]);
        } finally {
            shim.native.clearTimeout(guard);
        }
    },
};

function warnRawTimers(shim: TimerShim, now: number): void {
    const realNow = performance.now();
    for (const raw of shim.rawTimers.values()) {
        if (raw.warned || raw.dueAt > now || raw.realDueAt <= realNow) continue;
        raw.warned = true;
        const fn = raw.interval ? "setInterval" : "setTimeout";
        GGLog.warn(LOG_CONTEXT, `GGTest.clock moved past a raw ${fn}(…, ${raw.ms}) that still runs on real time. If it should follow the clock, use GGLocator.${fn}. Set at: ${raw.site}`);
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
