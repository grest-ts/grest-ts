import {GGRuntime} from "@grest-ts/runtime"
import {GGConfig, GGConfigLocator, GGConfigStoreLocal, GGSetting} from "@grest-ts/config"
import {GGInstanceLock} from "@grest-ts/lock"
import {mockable} from "@grest-ts/testkit-runtime"
import {GGJob, GGJobRunner, IsGGJobSettings} from "@grest-ts/job"

export const COUNTING = {intervalMs: 50, timeoutMs: 1_000, startupDelayMs: 0}

export const JobTestConfig = GGConfig.define("/job_test/", () => ({
    counting: new GGSetting("counting", IsGGJobSettings, COUNTING, "The counting job"),
}))

export const processed: number[] = []

@mockable
export class CountingSource {
    async rows(): Promise<number[]> {
        return [Date.now()]
    }
}

class CountingJob extends GGJob<number> {
    private readonly source = new CountingSource()

    constructor() {
        super({name: "counting", runOn: "everyInstance", settings: JobTestConfig.counting})
    }

    getDataSet(): Promise<number[]> {
        return this.source.rows()
    }

    async processRow(row: number): Promise<void> {
        if (row < 0) throw new Error("negative row")
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
