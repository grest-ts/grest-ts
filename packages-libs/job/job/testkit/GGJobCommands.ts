import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit"
import {IPCClient} from "@grest-ts/ipc"
import {GG_JOB_RUNNER, GGJobRunner} from "../src/GGJobRunner"

export const GGJobIPC = {
    worker: {
        start: IPCClient.defineRequest<void, boolean>("job.start"),
    },
}

// In a runtime started by GGTest, jobs wait for t.jobs.run() / t.jobs.start(): timed runs would race the test.
const start = GGJobRunner.prototype.start
GGJobRunner.prototype.start = function (this: GGJobRunner) {
    if (!GG_TEST_RUNTIME_WORKER.has()) start.call(this)
}

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    GG_TEST_RUNTIME_WORKER.get().onIpcRequest(GGJobIPC.worker.start, () => {
        const runner = GG_JOB_RUNNER.tryGet()
        if (runner) start.call(runner)
        return !!runner
    })
})
