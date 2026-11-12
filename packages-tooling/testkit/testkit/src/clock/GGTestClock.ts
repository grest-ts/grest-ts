import {GG_TEST_RUNNER, GGTestRunner} from "../GGTestRunner";
import {GGTestRuntimeState} from "../GGTestRuntime";
import {GGTestComponent} from "../testers/GGTestComponent";
import {GGClockIPC} from "./GGClockIPC";
import {GGClockState, GGDateShim, installDateShim} from "./GGDateShim";
import {GGTimerShim, installTimerShim} from "./GGTimerShim";

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
    /** Real time to wait for the promises of the timers it fires. Default 30 s. */
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
     * e.g. a package's `testkit/index-testkit.ts`.
     */
    public static onChange(hook: (state: GGClockState) => unknown): void {
        hooks().push(hook);
    }

    /** Jump to `time`; the clock keeps running from there (or stays stopped at it). Forward, it fires due timers as `advance` does. */
    public set(time: Date | number): Promise<void> {
        const target = time instanceof Date ? time.getTime() : time;
        return this.change(state => state.stoppedAt === undefined
            ? {offsetMs: target - GGDateShim.realNow()}
            : {offsetMs: state.offsetMs, stoppedAt: target});
    }

    /**
     * Jump forward by `ms`, like a machine waking from sleep. Resolves once every runtime is on the new time, and every
     * scope timer (`GGLocator.setTimeout/setInterval`) that was due by then has fired once, in due order per runtime,
     * runtimes in start order, and the promises they returned have settled. A rejection fails the advance.
     */
    public advance(ms: number, options: GGTestClockAdvanceOptions = {}): Promise<void> {
        if (!(ms >= 0)) throw new Error(`GGTest.clock.advance(${ms}): ms must be a non-negative number`);
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
        return applyClock(runner, next(GGDateShim.getState()), timeoutMs);
    }
}

/** This isolate's half of a change: the new state, timers re-armed for it, then the hooks. */
export async function applyLocalClock(state: GGClockState): Promise<void> {
    if (GGDateShim.same(state, GGDateShim.getState())) return;
    GGDateShim.setState(state);
    GGTimerShim.rearm();
    for (const hook of hooks()) await hook({...state});
}

async function applyClock(runner: GGTestRunner, state: GGClockState, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    await applyLocalClock(state);
    const runtimes = runner.getAllRuntimes().filter(r => r.state === GGTestRuntimeState.STARTED);
    await Promise.all(runtimes.map(r => GGDateShim.isDefault(state)
        ? r.sendCommand(GGClockIPC.worker.reset, undefined)
        : r.sendCommand(GGClockIPC.worker.set, state)));
    // Every isolate is on the new time before any timer fires, so a timer that calls another runtime finds it there.
    await GGTimerShim.fireDue(timeoutMs);
    for (const runtime of runtimes) {
        await runtime.sendCommand(GGClockIPC.worker.fireDue, {timeoutMs}, timeoutMs + 5_000);
    }
}

export class GGClockTestComponent implements GGTestComponent {

    private readonly runner: GGTestRunner;
    private readonly frames: GGClockState[] = [];

    constructor(runner: GGTestRunner) {
        this.runner = runner;
    }

    async beforeAll(): Promise<void> {
        this.frames.push(GGDateShim.getState());
    }

    async afterAll(): Promise<void> {
        await this.restore();
    }

    async beforeEach(): Promise<void> {
        this.frames.push(GGDateShim.getState());
    }

    async afterEach(): Promise<void> {
        await this.restore();
    }

    async teardown(): Promise<void> {
        await applyLocalClock(GGDateShim.DEFAULT_STATE);
    }

    private async restore(): Promise<void> {
        const previous = this.frames.pop();
        if (previous && !GGDateShim.same(previous, GGDateShim.getState())) {
            await applyClock(this.runner, previous);
        }
    }
}

GGTestRunner.registerExtension(GGClockTestComponent);
