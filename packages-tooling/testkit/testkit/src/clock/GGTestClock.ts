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
        return this.change(state => state.stoppedAt === undefined
            ? {offsetMs: target - GGDateShim.realNow()}
            : {offsetMs: state.offsetMs, stoppedAt: target});
    }

    /** Jump forward by `ms`. Only moves `Date`; timers are not fired. */
    public advance(ms: number): Promise<void> {
        if (!(ms >= 0)) throw new Error(`GGTest.clock.advance(${ms}): ms must be a non-negative number`);
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
        return applyClock(runner, next(GGDateShim.getState()));
    }
}

async function applyClock(runner: GGTestRunner, state: GGClockState): Promise<void> {
    GGDateShim.setState(state);
    const runtimes = runner.getAllRuntimes().filter(r => r.state === GGTestRuntimeState.STARTED);
    await Promise.all(runtimes.map(r => GGDateShim.isDefault(state)
        ? r.sendCommand(GGClockIPC.worker.reset, undefined)
        : r.sendCommand(GGClockIPC.worker.set, state)));
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
        if (!GGDateShim.isDefault(GGDateShim.getState())) GGDateShim.setState(GGDateShim.DEFAULT_STATE);
    }

    private async restore(): Promise<void> {
        const previous = this.frames.pop();
        if (previous && !GGDateShim.same(previous, GGDateShim.getState())) {
            await applyClock(this.runner, previous);
        }
    }
}

GGTestRunner.registerExtension(GGClockTestComponent);
