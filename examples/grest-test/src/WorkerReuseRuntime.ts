import {GGRuntime} from "@grest-ts/runtime"
import {testable} from "@grest-ts/testkit-runtime"

// Module-level on purpose: it counts the compose() runs in this worker's module graph, so tests can see a reused worker.
let composeRuns = 0

@testable
export class WorkerReuseProbe {
    private readonly composeRun: number

    constructor(composeRun: number) {
        this.composeRun = composeRun
    }

    public composeRunInWorker = async (): Promise<number> => this.composeRun
}

export class WorkerReuseRuntime extends GGRuntime {
    public static readonly NAME = "worker-reuse"

    protected compose(): void {
        new WorkerReuseProbe(++composeRuns)
    }
}

WorkerReuseRuntime.cli(import.meta.url).then()
