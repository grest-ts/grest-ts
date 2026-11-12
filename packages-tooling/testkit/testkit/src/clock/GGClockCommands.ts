import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGClockIPC} from "./GGClockIPC";
import {GGDateShim} from "./GGDateShim";
import {GGTimerShim} from "./GGTimerShim";
import {applyLocalClock, runClockHooks} from "./GGTestClock";

GGTestRuntimeWorker.onBeforeRuntimeStart(async () => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    worker.onIpcRequest(GGClockIPC.worker.set, state => applyLocalClock(state));
    worker.onIpcRequest(GGClockIPC.worker.reset, () => applyLocalClock(GGDateShim.DEFAULT_STATE));
    worker.onIpcRequest(GGClockIPC.worker.fireDue, ({target, timeoutMs}) => GGTimerShim.fireDue(target, timeoutMs));

    // Inline runtimes share the test isolate, whose clock is already current; the snapshot may be stale.
    const initial = worker.getInitialCommandsFor(GGClockIPC.worker.set).at(-1);
    if (!initial || worker.config.inline) return;
    GGDateShim.setState(initial.payload);
    // Extensions have loaded by now, so their hooks see the clock this runtime boots on.
    const errors = await runClockHooks(initial.payload);
    if (errors.length > 0) throw errors[0];
});
