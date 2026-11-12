import {GGLog} from "@grest-ts/logger";
import {GG_TEST_RUNNER, GGTestRunner} from "../GGTestRunner";
import {GGTestRuntimeState} from "../GGTestRuntime";
import {GGTestComponent} from "../testers/GGTestComponent";
import {GGClockIPC} from "./GGClockIPC";
import {GGClockState, GGDateShim} from "./GGDateShim";

/**
 * One fake wall clock (`Date`) shared by the test and every runtime it started.
 * Time keeps flowing unless stopped. Set in a test: undone after it. Set in describe or beforeAll: holds for that block.
 */
export class GGTestClock {

    /** Jump to `time`; the clock keeps running from there (or stays stopped at it). */
    public set(time: Date | number): Promise<void> {
        const target = time instanceof Date ? time.getTime() : time;
        if (!Number.isInteger(target)) throw new Error(`GGTest.clock.set(${String(time)}): not a valid time`);
        return this.change(state => state.stoppedAt === undefined
            ? {offsetMs: target - GGDateShim.realNow()}
            : {offsetMs: state.offsetMs, stoppedAt: target});
    }

    /** Jump forward by `ms`. Only moves `Date`; timers are not fired. */
    public advance(ms: number): Promise<void> {
        if (!(Number.isInteger(ms) && ms >= 0)) throw new Error(`GGTest.clock.advance(${ms}): ms must be a non-negative integer`);
        return this.change(state => state.stoppedAt === undefined
            ? {offsetMs: state.offsetMs + ms}
            : {offsetMs: state.offsetMs, stoppedAt: state.stoppedAt + ms});
    }

    /** Stop time: `Date.now()` stays put until the next set/advance/start. */
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

    private change(next: (state: GGClockState) => GGClockState): Promise<void> {
        GGDateShim.assertActive();
        const runner = GG_TEST_RUNNER.get();
        if (!runner.started) {
            beforeAll(() => this.change(next));
            return Promise.resolve();
        }
        const current = GGDateShim.getState();
        const state = next(current);
        return GGDateShim.same(state, current) ? Promise.resolve() : applyClock(runner, state);
    }
}

async function applyClock(runner: GGTestRunner, state: GGClockState): Promise<void> {
    GGDateShim.setState(state);
    const runtimes = runner.getAllRuntimes().filter(r => r.state === GGTestRuntimeState.STARTED);
    const results = await Promise.allSettled(runtimes.map(r => r.sendCommand(GGClockIPC.worker.set, state)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length > 0) throw new AggregateError(failed.map(f => f.reason), `GGTest.clock: ${failed.length} runtime(s) didn't take the new time: ${failed.map(f => f.reason?.message).join("; ")}`);
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
        if (!GGDateShim.isDefault(GGDateShim.getState())) GGDateShim.setState(GGDateShim.DEFAULT_STATE);
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
