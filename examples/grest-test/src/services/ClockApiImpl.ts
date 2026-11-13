import {sleep} from "@grest-ts/common"
import {GGLocator} from "@grest-ts/locator"
import type {ClockReading, ScheduleTimer} from "../api/ClockApi"

const BOOT = Date.now()

export class ClockApiImpl {
    private firedIds: string[] = []
    private readonly timers = new Map<string, NodeJS.Timeout>()

    public read = async (): Promise<ClockReading> => ({
        now: Date.now(),
        boot: BOOT,
        newDate: new Date().getTime(),
        fixed: new Date("2020-01-02T03:04:05Z").getTime(),
        isDate: new Date() instanceof Date && new Date().constructor === Date,
    })

    public schedule = async ({id, ms, interval, asyncMs, fail, nested, nestedMs, refreshes}: ScheduleTimer): Promise<void> => {
        const fire = () => {
            this.firedIds.push(id)
            if (refreshes) this.timers.get(refreshes)!.refresh()
            if (nested) void this.schedule({id: id + ":nested", ms: nestedMs ?? ms})
            if (fail) return Promise.reject(new Error(`timer ${id} failed`))
            if (asyncMs) return sleep(asyncMs).then(() => { this.firedIds.push(id + ":done") })
            return undefined
        }
        this.timers.set(id, interval ? GGLocator.setInterval(fire, ms) : GGLocator.setTimeout(fire, ms))
    }

    public rawTimer = async ({id, ms}: {id: string, ms: number}): Promise<void> => {
        this.timers.set(id, setTimeout(() => {}, ms).unref())
    }

    public cancel = async ({id, by}: {id: string, by?: "handle" | "id" | "close"}): Promise<void> => {
        const timer = this.timers.get(id)!
        if (by === "close") timer.close()
        else clearTimeout(by === "id" ? +timer : timer)
    }

    public refresh = async ({id}: {id: string}): Promise<void> => {
        this.timers.get(id)!.refresh()
    }

    public fired = async (): Promise<string[]> => this.firedIds

    public reset = async (): Promise<void> => {
        for (const timer of this.timers.values()) clearTimeout(timer)
        this.timers.clear()
        this.firedIds = []
    }
}
