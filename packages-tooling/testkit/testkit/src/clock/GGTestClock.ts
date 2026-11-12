import {GGLog} from "@grest-ts/logger";
import {TestRunner} from "vitest";
import {GG_TEST_RUNNER, GGTestRunner} from "../GGTestRunner";
import {GGTestMode, GGTestRuntimeState} from "../GGTestRuntime";
import {GGTestComponent} from "../testers/GGTestComponent";
import {fireDueOn, GGClockIPC} from "./GGClockIPC";
import {GGClockState, GGDateShim, installDateShim} from "./GGDateShim";
import {GGTimerShim, installTimerShim, rejections, throwAll} from "./GGTimerShim";

const DEFAULT_TIMEOUT_MS = 30_000;
const HOOKS = Symbol.for("@grest-ts/testkit:GGTestClock.hooks");
const hookSlot = globalThis as unknown as Record<symbol, ((state: GGClockState) => unknown)[] | undefined>;
const hooks = () => hookSlot[HOOKS] ??= [];

/** Fake Date, and scope timers that follow it. Install before any app module loads. */
export function installTestClock(): void {
    installDateShim();
    installTimerShim();
}

export interface GGTestClockAdvanceOptions {
    /**
     * Real time to wait for the promises of the timers it fires, across all runtimes. Default: the current test's
     * timeout less a margin, or 30 s outside a test.
     */
    timeoutMs?: number
}

/**
 * One fake wall clock (`Date`) shared by the test and every runtime it started.
 * Time keeps flowing unless stopped. Set in a test: undone after it. Set in describe or beforeAll: holds for that block.
 */
export class GGTestClock {

    /**
     * Runs `hook` in this isolate whenever the clock changes, before the change is acknowledged and before any timer
     * fires. For clocks the framework doesn't own, such as an SDK's clock offset. Register it from test-only code,
     * e.g. a package's `testkit/index-testkit.ts`. Registered while the clock is off real time, it runs once right away.
     */
    public static onChange(hook: (state: GGClockState) => unknown): void {
        hooks().push(hook);
        const state = GGDateShim.getState();
        if (GGDateShim.isDefault(state)) return;
        Promise.resolve().then(() => hook({...state})).catch(err => GGLog.warn(GGTestClock, "GGTest.clock: onChange hook failed", err as Error));
    }

    /** Jump to `time`; the clock keeps running from there (or stays stopped at it). Forward, it fires due timers as `advance` does. */
    public set(time: Date | number): Promise<void> {
        const target = time instanceof Date ? time.getTime() : time;
        if (!Number.isInteger(target)) throw new Error(`GGTest.clock.set(${String(time)}): not a valid time, expected whole epoch milliseconds`);
        return this.change(state => state.stoppedAt === undefined
            ? {offsetMs: target - GGDateShim.realNow()}
            : {offsetMs: state.offsetMs, stoppedAt: target});
    }

    /**
     * Jump forward by `ms`, like a machine waking from sleep. Resolves once every runtime is on the new time, and every
     * scope timer (`GGLocator.setTimeout/setInterval`) that was due by then has fired once: started in due order per
     * runtime, runtimes in start order, and their returned promises awaited together. Any rejection fails the advance,
     * after every runtime has fired its timers.
     */
    public advance(ms: number, options: GGTestClockAdvanceOptions = {}): Promise<void> {
        if (!(Number.isInteger(ms) && ms >= 0)) throw new Error(`GGTest.clock.advance(${ms}): ms must be a non-negative integer`);
        return this.change(state => state.stoppedAt === undefined
            ? {offsetMs: state.offsetMs + ms}
            : {offsetMs: state.offsetMs, stoppedAt: state.stoppedAt + ms}, options.timeoutMs);
    }

    /** Stop time: `Date.now()` stays put, and scope timers wait, until the next set/advance/start. */
    public stop(): Promise<void> {
        return this.change(state => state.stoppedAt === undefined
            ? {offsetMs: state.offsetMs, stoppedAt: Date.now()}
            : state);
    }

    /** Let time flow again from the current fake now. */
    public start(): Promise<void> {
        return this.change(state => state.stoppedAt === undefined
            ? state
            : {offsetMs: state.stoppedAt - GGDateShim.realNow()});
    }

    public now(): number {
        GGDateShim.assertActive();
        return Date.now();
    }

    private change(next: (state: GGClockState) => GGClockState, timeoutMs?: number): Promise<void> {
        GGDateShim.assertActive();
        const runner = GG_TEST_RUNNER.get();
        if (!runner.started) {
            beforeAll(() => this.change(next, timeoutMs));
            return Promise.resolve();
        }
        const current = GGDateShim.getState();
        const state = next(current);
        return GGDateShim.same(state, current) ? Promise.resolve() : applyClock(runner, state, timeoutMs);
    }
}

/**
 * This isolate's half of a change: the new state, the hooks, timers re-armed, and the barrier snapshot of pending
 * timers. Hook errors are thrown at the end, after the rest is done.
 */
export async function applyLocalClock(state: GGClockState): Promise<void> {
    let errors: unknown[] = [];
    if (!GGDateShim.same(state, GGDateShim.getState())) {
        GGDateShim.setState(state);
        errors = await runClockHooks(state);
        GGTimerShim.rearm();
    }
    GGTimerShim.snapshot();
    throwAll(errors);
}

async function runClockHooks(state: GGClockState): Promise<unknown[]> {
    return rejections(await Promise.allSettled(hooks().map(async hook => hook({...state}))));
}

async function applyClock(runner: GGTestRunner, state: GGClockState, timeoutMs = defaultTimeoutMs()): Promise<void> {
    const errors: unknown[] = [];
    const collect = (work: Promise<unknown>) => work.then(() => {}, err => { errors.push(err); });
    const deadline = performance.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - performance.now());

    // Inline runtimes share this isolate: its own apply and fireDue cover them.
    const runtimes = runner.getAllRuntimes().filter(r => r.state === GGTestRuntimeState.STARTED && r.mode !== GGTestMode.INLINE);
    await collect(applyLocalClock(state));
    await Promise.all(runtimes.map(r => collect(r.sendCommand(GGClockIPC.worker.set, state))));
    // Every isolate is on the new time before any timer fires, so a timer that calls another runtime finds it there.
    const target = Date.now();
    await collect(GGTimerShim.fireDue(target, remaining()));
    for (const runtime of runtimes) {
        await collect(fireDueOn(runtime, target, remaining()));
    }
    throwAll(errors);
}

/** Inside a test: its timeout less a margin, so the guard reports the stuck timer before vitest times the test out. */
function defaultTimeoutMs(): number {
    const timeout = TestRunner.getCurrentTest()?.timeout;
    return timeout ? Math.max(100, timeout - Math.min(1_000, timeout / 5)) : DEFAULT_TIMEOUT_MS;
}

export class GGClockTestComponent implements GGTestComponent {

    private readonly runner: GGTestRunner;
    private readonly frames: GGClockState[] = [];
    // Separate from the block frames: if another component's beforeEach threw, ours didn't run, but afterEach still does.
    private testFrame?: GGClockState;

    constructor(runner: GGTestRunner) {
        this.runner = runner;
    }

    async beforeAll(): Promise<void> {
        this.frames.push(GGDateShim.getState());
    }

    async afterAll(): Promise<void> {
        await this.restore(this.frames.pop());
    }

    async beforeEach(): Promise<void> {
        this.testFrame = GGDateShim.getState();
    }

    async afterEach(): Promise<void> {
        const frame = this.testFrame;
        this.testFrame = undefined;
        await this.restore(frame);
    }

    async teardown(): Promise<void> {
        GGTimerShim.resetWarnings();
        await applyLocalClock(GGDateShim.DEFAULT_STATE);
    }

    // Never throws: a runtime that died mustn't keep later components' afterEach from running.
    private async restore(previous: GGClockState | undefined): Promise<void> {
        if (!previous || GGDateShim.same(previous, GGDateShim.getState())) return;
        try {
            await applyClock(this.runner, previous);
        } catch (err) {
            GGLog.warn(this, "GGTest.clock: restoring the clock failed", err as Error);
        }
    }
}

GGTestRunner.registerExtension(GGClockTestComponent);
