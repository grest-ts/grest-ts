import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGClockIPC} from "./GGClockIPC";
import {GGTimerShim} from "./GGTimerShim";
import {applyLocalClock} from "./GGTestClock";

// The loader sets the boot clock before extensions load, so GGTestClock.onChange runs their hooks for it.
GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    worker.onIpcRequest(GGClockIPC.worker.set, state => applyLocalClock(state));
    worker.onIpcRequest(GGClockIPC.worker.fireDue, ({target, timeoutMs}) => GGTimerShim.fireDue(target, timeoutMs));
});
