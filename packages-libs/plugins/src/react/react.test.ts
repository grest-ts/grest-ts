import {describe, expect, it} from "vitest"
import {createElement, type ReactNode} from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {GGPoint} from "../GGPoint"
import {GGPluginHost} from "../GGPluginHost"
import {GGPluginsProvider, useSlot, useSlotHooks, useSlotOne} from "./index"

const Items = GGPoint.many<string>("items")
const Panel = GGPoint.one<string>("panel")
const host = new GGPluginHost<object>({plugins: {
    a: {provides: [Items.provide("a"), Panel.provide("panel of a")]},
    b: {provides: [Items.provide("b")]},
}})
const useIsOn = (scope: string | undefined) => (name: string) => scope !== "ws1" || name === "b"

function render(body: () => unknown): string {
    const Probe = (): ReactNode => JSON.stringify(body())
    return renderToStaticMarkup(createElement(GGPluginsProvider, {host, useIsOn}, createElement(Probe)))
}

describe("react binding", () => {
    it("useSlot gives the items of plugins on in the scope", () => {
        expect(render(() => useSlot(Items))).toBe(`["a","b"]`.replace(/"/g, "&quot;"))
        expect(render(() => useSlot(Items, "ws1"))).toBe(`["b"]`.replace(/"/g, "&quot;"))
    })

    it("useSlotOne is undefined while its provider is off", () => {
        expect(render(() => useSlotOne(Panel))).toBe("&quot;panel of a&quot;")
        expect(render(() => useSlotOne(Panel, "ws1") ?? null)).toBe("null")
    })

    it("useSlotHooks calls every item's hook and keeps the results of the ones on", () => {
        const called: string[] = []
        const out = render(() => useSlotHooks(Items, (item, on) => {
            called.push(`${item}:${on}`)
            return item.toUpperCase()
        }, "ws1"))
        expect(called).toEqual(["a:false", "b:true"])
        expect(out).toBe(`["B"]`.replace(/"/g, "&quot;"))
    })

    it("throws without a provider", () => {
        const Probe = (): ReactNode => JSON.stringify(useSlot(Items))
        expect(() => renderToStaticMarkup(createElement(Probe))).toThrow("No GGPluginsProvider")
    })
})
