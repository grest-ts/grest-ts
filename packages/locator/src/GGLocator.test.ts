import type {AsyncLocalStorage} from "node:async_hooks"
import {GGLocator} from "./GGLocator"
import {GGLocatorScope} from "./GGLocatorScope"
import {GG_ASYNC_STORAGE} from "./GGLocatorStorage"

const outsideScope = <R>(fn: () => R): R => (GG_ASYNC_STORAGE as unknown as AsyncLocalStorage<GGLocatorScope>).exit(fn)

describe("GGLocator.setTimeout outside a scope", () => {
    test("is a plain timer that warns once per call site while a runtime's scope owns timers", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        try {
            const runtime = new GGLocatorScope("runtime")
            runtime.ownTimers()
            const fired: number[] = []
            const set = (n: number) => outsideScope(() => GGLocator.setTimeout(() => { fired.push(n) }, 1))
            set(1)
            set(2)
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toMatch(/GGLocator\.setTimeout was called outside a GGLocatorScope while a runtime runs[\s\S]*GGLocator\.test\.ts/)
            await vi.waitFor(() => expect(fired).toEqual([1, 2]))

            runtime.clearTimers()
            outsideScope(() => GGLocator.setInterval(() => {}, 1_000)).close()
            expect(warn).toHaveBeenCalledTimes(1)
        } finally {
            warn.mockRestore()
        }
    })
})
