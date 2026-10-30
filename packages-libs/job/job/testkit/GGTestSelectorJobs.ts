import {GGTestAction, GGTestError, GGTestRuntime, GGTestSelector, GGTestSelectorExtension, RuntimeConstructor, tActionRawData} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import type {GGJobRunResult} from "../src/GGJobRunner"
import {GGJobIPC} from "./GGJobCommands"

export class GGTestSelectorJobs extends GGTestSelectorExtension {

    public static readonly PROPERTY_NAME = "jobs"

    /** Runs the job now on the first selected runtime that has it; pick an instance with `t[i]`. */
    run(name: string): GGTestJobRunAction {
        return new GGTestJobRunAction(this.runtimes, name)
    }

    /** Starts the selected runtimes' job schedules, as outside tests. */
    async start(): Promise<void> {
        await Promise.all(this.runtimes.map(runtime => runtime.sendCommand(GGJobIPC.worker.start, undefined)))
    }
}

export class GGTestJobRunAction extends GGTestAction<GGJobRunResult> {

    private readonly runtimes: GGTestRuntime[]
    private readonly name: string

    constructor(runtimes: GGTestRuntime[], name: string) {
        super(new GGContext("GGTestJobRun"), {noResponse: false, logData: {message: `[Job ${name}]`}})
        this.runtimes = runtimes
        this.name = name
    }

    protected async executeAction(): Promise<tActionRawData> {
        for (const runtime of this.runtimes) {
            const reply = await runtime.sendCommand(GGJobIPC.worker.run, {name: this.name})
            if (!reply.found) continue
            if ("error" in reply) {
                throw new GGTestError({test: `Job ${this.name}`, expected: "The run to complete", received: reply.error, extra: reply.stack})
            }
            return reply.result
        }
        throw new GGTestError({
            test: `Job ${this.name}`,
            expected: "A GGJobRunner with this job in a selected runtime",
            received: `None in ${this.runtimes.map(r => r.name).join(", ")}`,
        })
    }
}

declare module "@grest-ts/testkit" {
    interface SelectorExtensions<T extends RuntimeConstructor[]> {
        jobs: GGTestSelectorJobs
    }
}

GGTestSelector.addExtension(GGTestSelectorJobs)
