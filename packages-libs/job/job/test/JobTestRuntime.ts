import {GGRuntime} from "@grest-ts/runtime"
import {GGConfig, GGConfigLocator, GGConfigStoreLocal, GGSetting} from "@grest-ts/config"
import {GGInstanceLock} from "@grest-ts/lock"
import {GGJob, GGJobRunner, IsGGJobSettings} from "@grest-ts/job"

export const COUNTING = {intervalMs: 50, timeoutMs: 1_000, startupDelayMs: 0}

export const JobTestConfig = GGConfig.define("/job_test/", () => ({
    counting: new GGSetting("counting", IsGGJobSettings, COUNTING, "The counting job"),
}))

export const processed: number[] = []

class CountingJob extends GGJob<number> {
    constructor() {
        super({name: "counting", runOn: "everyInstance", settings: JobTestConfig.counting})
    }

    async getDataSet(): Promise<number[]> {
        return [Date.now()]
    }

    async processRow(row: number): Promise<void> {
        processed.push(row)
    }
}

export class JobTestRuntime extends GGRuntime {
    public static readonly NAME = "job-test"

    protected compose(): void {
        new GGConfigLocator(JobTestConfig)
            .add(GGSetting, new GGConfigStoreLocal(JobTestConfig, {counting: COUNTING}))
        new GGJobRunner({lock: new GGInstanceLock()}).add(new CountingJob())
    }
}

JobTestRuntime.cli(import.meta.url).then()
