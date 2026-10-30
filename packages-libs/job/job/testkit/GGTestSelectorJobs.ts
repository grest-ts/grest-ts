import {GGTestActionForLocatorOnCall, GGTestSelector, GGTestSelectorExtension, RuntimeConstructor} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {GG_JOB_RUNNER, type GGJobRunResult} from "../src/GGJobRunner"
import {GGJobIPC} from "./GGJobCommands"

export class GGTestSelectorJobs extends GGTestSelectorExtension {

    public static readonly PROPERTY_NAME = "jobs"

    /** Runs the job now on the selected runtime that has a job runner; pick an instance with `t[i]`. */
    run(name: string): GGTestActionForLocatorOnCall<GGJobRunResult> {
        return new GGTestActionForLocatorOnCall(new GGContext("GGTestJobRun"), GG_JOB_RUNNER.name, "run", [name], this.runtimes)
    }

    /** Starts the selected runtimes' job schedules, as outside tests. */
    async start(): Promise<void> {
        await this.forEachParallel(async runtime => { await runtime.sendCommand(GGJobIPC.worker.start, undefined) })
    }
}

declare module "@grest-ts/testkit" {
    interface SelectorExtensions<T extends RuntimeConstructor[]> {
        jobs: GGTestSelectorJobs
    }
}

GGTestSelector.addExtension(GGTestSelectorJobs)
