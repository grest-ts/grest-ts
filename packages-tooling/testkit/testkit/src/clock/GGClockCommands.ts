import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGClockIPC} from "./GGClockIPC";
import {GGDateShim} from "./GGDateShim";

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    // Inline runtimes share the test isolate, whose clock is already current; the snapshot may be stale.
    if (worker.config.clock && !worker.config.inline) GGDateShim.setState(worker.config.clock);

    worker.ipcClient.onFrameworkRequest(GGClockIPC.worker.set, async (state) => {
        GGDateShim.setState(state);
    });
});
