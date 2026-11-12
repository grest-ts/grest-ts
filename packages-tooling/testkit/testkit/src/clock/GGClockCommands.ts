import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGClockIPC} from "./GGClockIPC";
import {GGDateShim} from "./GGDateShim";

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    const initial = worker.getInitialCommandsFor(GGClockIPC.worker.set).at(-1);
    if (initial) GGDateShim.setState(initial.payload);

    worker.ipcClient.onFrameworkRequest(GGClockIPC.worker.set, async (state) => {
        GGDateShim.setState(state);
    });
    worker.ipcClient.onFrameworkRequest(GGClockIPC.worker.reset, async () => {
        GGDateShim.setState(GGDateShim.DEFAULT_STATE);
    });
});
