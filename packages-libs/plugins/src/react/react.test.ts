import {describe, expect, it} from "vitest"
import {createElement, type ReactNode} from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {GGPoint} from "../GGPoint"
import {GGPluginHost} from "../GGPluginHost"
import {GGPluginsProvider, usePoint, usePointHooks, usePointOne} from "./index"

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
    it("usePoint gives the items of plugins on in the scope", () => {
        expect(render(() => usePoint(Items))).toBe(`["a","b"]`.replace(/"/g, "&quot;"))
        expect(render(() => usePoint(Items, "ws1"))).toBe(`["b"]`.replace(/"/g, "&quot;"))
    })

    it("usePointOne is undefined while its provider is off", () => {
        expect(render(() => usePointOne(Panel))).toBe("&quot;panel of a&quot;")
        expect(render(() => usePointOne(Panel, "ws1") ?? null)).toBe("null")
    })

    it("usePointHooks calls every item's hook and keeps the results of the ones on", () => {
        const called: string[] = []
        const out = render(() => usePointHooks(Items, (item, on) => {
            called.push(`${item}:${on}`)
            return item.toUpperCase()
        }, "ws1"))
        expect(called).toEqual(["a:false", "b:true"])
        expect(out).toBe(`["B"]`.replace(/"/g, "&quot;"))
    })

    it("throws without a provider", () => {
        const Probe = (): ReactNode => JSON.stringify(usePoint(Items))
        expect(() => renderToStaticMarkup(createElement(Probe))).toThrow("No GGPluginsProvider")
    })
})
