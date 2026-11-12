import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGClockIPC} from "./GGClockIPC";
import {GGDateShim} from "./GGDateShim";
import {GGTimerShim} from "./GGTimerShim";
import {applyLocalClock} from "./GGTestClock";

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    const initial = worker.getInitialCommandsFor(GGClockIPC.worker.set).at(-1);
    // Inline runtimes share the test isolate, whose clock is already current; the snapshot may be stale.
    if (initial && !worker.config.inline) GGDateShim.setState(initial.payload);

    worker.onIpcRequest(GGClockIPC.worker.set, state => applyLocalClock(state));
    worker.onIpcRequest(GGClockIPC.worker.reset, () => applyLocalClock(GGDateShim.DEFAULT_STATE));
    worker.onIpcRequest(GGClockIPC.worker.fireDue, ({timeoutMs}) => GGTimerShim.fireDue(timeoutMs));
});
