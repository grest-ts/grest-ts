import {GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GG_TEST_RUNTIME_WORKER} from "../GGTestRuntimeWorkerKey";
import {GGClockIPC} from "./GGClockIPC";
import {GGTimerShim} from "./GGTimerShim";
import {applyLocalClock, runBootHooks} from "./GGTestClock";

GGTestRuntimeWorker.onBeforeRuntimeStart(async () => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    worker.onIpcRequest(GGClockIPC.worker.set, state => applyLocalClock(state));
    worker.onIpcRequest(GGClockIPC.worker.fireDue, ({target, timeoutMs}) => GGTimerShim.fireDue(target, timeoutMs));
    await runBootHooks();
});
