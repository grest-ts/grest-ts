export interface GGClockState {
    offsetMs: number
    stoppedAt?: number
}

interface DateShim {
    date: DateConstructor
    realNow: () => number
    state: GGClockState
}

// On globalThis, not module state: vitest projects can evaluate this module more than once in one process.
const KEY = Symbol.for("@grest-ts/testkit:GGDateShim")
const slot = globalThis as unknown as Record<symbol, DateShim | undefined>

export function installDateShim(): void {
    if (slot[KEY]) return
    const RealDate = globalThis.Date
    const shim: DateShim = {date: undefined!, realNow: () => RealDate.now(), state: {offsetMs: 0}}
    const now = () => shim.state.stoppedAt ?? RealDate.now() + shim.state.offsetMs

    function Date(this: unknown, ...args: unknown[]) {
        if (!new.target) return new RealDate(now()).toString()
        return Reflect.construct(RealDate, args.length ? args : [now()], new.target)
    }
    Object.setPrototypeOf(Date, RealDate)
    Object.defineProperty(Date, "length", {value: RealDate.length})
    // Shared prototype keeps instanceof working for Dates created by native code (structuredClone, drivers).
    Date.prototype = RealDate.prototype
    Object.defineProperty(RealDate.prototype, "constructor", {value: Date, writable: true, configurable: true})
    Date.now = now

    shim.date = Date as unknown as DateConstructor
    slot[KEY] = shim
    globalThis.Date = shim.date
}

const DEFAULT_STATE: GGClockState = {offsetMs: 0}

function getShim(): DateShim {
    const shim = slot[KEY]
    if (!shim) throw new Error("GGTest.clock: the Date shim is not installed. Add '@grest-ts/testkit-vitest' to vitest setupFiles.")
    return shim
}

export const GGDateShim = {
    DEFAULT_STATE,

    assertActive(): void {
        if (globalThis.Date !== getShim().date) {
            throw new Error("GGTest.clock: globalThis.Date is not the test clock. vi.useFakeTimers faked Date; leave Date out of toFake, or use GGTest.clock, not both.")
        }
    },

    realNow(): number {
        return getShim().realNow()
    },

    getState(): GGClockState {
        return {...slot[KEY]?.state ?? DEFAULT_STATE}
    },

    setState(state: GGClockState): void {
        getShim().state = {...state}
    },

    isDefault(state: GGClockState): boolean {
        return state.offsetMs === 0 && state.stoppedAt === undefined
    },

    same(a: GGClockState, b: GGClockState): boolean {
        return a.offsetMs === b.offsetMs && a.stoppedAt === b.stoppedAt
    },
}
