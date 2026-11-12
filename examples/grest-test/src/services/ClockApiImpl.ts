import type {ClockReading} from "../api/ClockApi"

const BOOT = Date.now()

export class ClockApiImpl {
    public read = async (): Promise<ClockReading> => ({
        now: Date.now(),
        boot: BOOT,
        newDate: new Date().getTime(),
        fixed: new Date("2020-01-02T03:04:05Z").getTime(),
        isDate: new Date() instanceof Date && new Date().constructor === Date,
    })
}
