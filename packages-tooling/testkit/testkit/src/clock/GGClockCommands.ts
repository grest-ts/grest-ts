import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGClockIPC} from "./GGClockIPC";
import {GGTimerShim} from "./GGTimerShim";
import {applyLocalClock, runClockHooks} from "./GGTestClock";

GGTestRuntimeWorker.onBeforeRuntimeStart(async () => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    worker.onIpcRequest(GGClockIPC.worker.set, state => applyLocalClock(state));
    worker.onIpcRequest(GGClockIPC.worker.fireDue, ({target, timeoutMs}) => GGTimerShim.fireDue(target, timeoutMs));

    // The loader set the boot clock; inline runtimes share the test isolate, which already ran the hooks.
    const clock = worker.config.clock;
    if (!clock || worker.config.inline) return;
    // Extensions have loaded by now, so their hooks see the clock this runtime boots on.
    const errors = await runClockHooks(clock);
    if (errors.length > 0) throw errors[0];
});
