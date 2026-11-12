import {sleep} from "@grest-ts/common"
import {GGLocator} from "@grest-ts/locator"
import {GGTestClock} from "@grest-ts/testkit"
import type {ClockReading, ScheduleTimer} from "../api/ClockApi"

const clockChanges: number[] = []
GGTestClock.onChange(state => { clockChanges.push(state.offsetMs) })

export class ClockApiImpl {
    private firedIds: string[] = []
    private readonly timers = new Map<string, NodeJS.Timeout>()

    public read = async (): Promise<ClockReading> => ({
        now: Date.now(),
        newDate: new Date().getTime(),
        fixed: new Date("2020-01-02T03:04:05Z").getTime(),
        isDate: new Date() instanceof Date && new Date().constructor === Date,
    })

    public schedule = async ({id, ms, interval, asyncMs, fail, nested}: ScheduleTimer): Promise<void> => {
        const fire = () => {
            this.firedIds.push(id)
            if (nested) void this.schedule({id: id + ":nested", ms})
            if (fail) return Promise.reject(new Error(`timer ${id} failed`))
            if (asyncMs) return sleep(asyncMs).then(() => { this.firedIds.push(id + ":done") })
        }
        this.timers.set(id, interval ? GGLocator.setInterval(fire, ms) : GGLocator.setTimeout(fire, ms))
    }

    public rawTimer = async ({id, ms}: {id: string, ms: number}): Promise<void> => {
        this.timers.set(id, setTimeout(() => {}, ms).unref())
    }

    public cancel = async ({id}: {id: string}): Promise<void> => {
        clearTimeout(this.timers.get(id))
    }

    public fired = async (): Promise<string[]> => this.firedIds

    public clockChanges = async (): Promise<number[]> => clockChanges

    public reset = async (): Promise<void> => {
        for (const timer of this.timers.values()) clearTimeout(timer)
        this.timers.clear()
        this.firedIds = []
        clockChanges.length = 0
    }
}
