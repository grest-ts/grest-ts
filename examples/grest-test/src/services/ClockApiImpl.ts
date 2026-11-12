import type {ClockReading} from "../api/ClockApi"

export class ClockApiImpl {
    public read = async (): Promise<ClockReading> => ({
        now: Date.now(),
        newDate: new Date().getTime(),
        fixed: new Date("2020-01-02T03:04:05Z").getTime(),
        isDate: new Date() instanceof Date && new Date().constructor === Date,
    })
}
