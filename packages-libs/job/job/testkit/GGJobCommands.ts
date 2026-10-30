import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit"
import {IPCClient} from "@grest-ts/ipc"
import {GG_JOB_RUNNER, GGJobRunner, type GGJobRunResult} from "../src/GGJobRunner"

export type GGJobRunReply =
    | {found: false}
    | {found: true, result: GGJobRunResult}
    | {found: true, error: string, stack?: string}

export const GGJobIPC = {
    worker: {
        run: IPCClient.defineRequest<{name: string}, GGJobRunReply>("job.run"),
        start: IPCClient.defineRequest<void, void>("job.start"),
    },
}

// In a runtime started by GGTest, jobs wait for t.jobs.run() / t.jobs.start(): timed runs would race the test.
const start = GGJobRunner.prototype.start
GGJobRunner.prototype.start = function (this: GGJobRunner) {
    if (!GG_TEST_RUNTIME_WORKER.has()) start.call(this)
}

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get()

    worker.onIpcRequest(GGJobIPC.worker.run, async ({name}): Promise<GGJobRunReply> => {
        const runner = GG_JOB_RUNNER.tryGet()
        if (!runner?.has(name)) return {found: false}
        try {
            return {found: true, result: await runner.run(name)}
        } catch (err) {
            return {found: true, error: (err as Error).message, stack: (err as Error).stack}
        }
    })

    worker.onIpcRequest(GGJobIPC.worker.start, () => {
        const runner = GG_JOB_RUNNER.tryGet()
        if (runner) start.call(runner)
    })
})
