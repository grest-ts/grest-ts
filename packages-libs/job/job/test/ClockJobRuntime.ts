import {GGRuntime} from "@grest-ts/runtime"
import {GGConfig, GGConfigLocator, GGConfigStoreLocal, GGSetting} from "@grest-ts/config"
import {GGInstanceLock} from "@grest-ts/lock"
import {GGJob, GGJobRunner, IsGGJobSettings} from "@grest-ts/job"

export const COOLDOWN = {intervalMs: 5 * 60_000, timeoutMs: 30_000, startupDelayMs: 60_000}
const BLOCKING = {...COOLDOWN, startupDelayMs: 24 * 3600_000}

const ClockJobConfig = GGConfig.define("/clock_job_test/", () => ({
    cooldown: new GGSetting("cooldown", IsGGJobSettings, COOLDOWN, "Runs once per interval across instances"),
    blocking: new GGSetting("blocking", IsGGJobSettings, BLOCKING, "Runs until aborted"),
}))

export const runs = {cooldown: 0, blocking: 0}

class CooldownJob extends GGJob<number> {
    constructor() {
        super({name: "cooldown", settings: ClockJobConfig.cooldown})
    }

    async getDataSet(): Promise<number[]> {
        return [1]
    }

    async processRow(): Promise<void> {
        runs.cooldown++
    }
}

class BlockingJob extends GGJob<number> {
    constructor() {
        super({name: "blocking", settings: ClockJobConfig.blocking})
    }

    async getDataSet(): Promise<number[]> {
        return [1]
    }

    async processRow(_row: number, signal: AbortSignal): Promise<void> {
        runs.blocking++
        await new Promise(resolve => signal.addEventListener("abort", resolve))
    }
}

export class ClockJobRuntime extends GGRuntime {
    public static readonly NAME = "clock-job-test"

    protected compose(): void {
        new GGConfigLocator(ClockJobConfig)
            .add(GGSetting, new GGConfigStoreLocal(ClockJobConfig, {cooldown: COOLDOWN, blocking: BLOCKING}))
        new GGJobRunner({lock: new GGInstanceLock()}).add(new CooldownJob(), new BlockingJob())
    }
}

ClockJobRuntime.cli(import.meta.url).then()
