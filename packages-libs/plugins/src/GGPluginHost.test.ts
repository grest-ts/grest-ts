import {describe, expect, it} from "vitest"
import {GGPoint, type GGPointEntry} from "./GGPoint"
import {GGPluginHost} from "./GGPluginHost"

interface Facet {
    dependsOn?: string[]
    provides?: GGPointEntry[]
    config?(prefix: string): {prefix: string}
    compose?(ctx: string[], config: {prefix: string} | undefined): void | GGPointEntry[]
    wire?(ctx: string[]): void
}

const host = (plugins: Record<string, Facet>, isOn?: (name: string) => boolean) =>
    new GGPluginHost<Facet>({plugins, dependsOn: (_, f) => f.dependsOn, isOn})

describe("GGPluginHost", () => {
    it("orders dependencies first, then by name", () => {
        const h = host({c: {}, b: {dependsOn: ["c"]}, a: {dependsOn: ["b"]}, d: {}})
        expect(h.all.map(p => p.name)).toEqual(["c", "b", "a", "d"])
    })

    it("throws on an unknown dependency and on a cycle", () => {
        expect(() => host({a: {dependsOn: ["x"]}})).toThrow(`Plugin "a" depends on "x", which this host doesn't have`)
        expect(() => host({a: {dependsOn: ["b"]}, b: {dependsOn: ["a"]}})).toThrow("cycle among: a, b")
    })

    it("drops a plugin whose dependency is off, transitively", () => {
        const h = host({a: {}, b: {dependsOn: ["a"]}, c: {dependsOn: ["b"]}, d: {}}, name => name !== "a")
        expect(h.active.map(p => p.name)).toEqual(["d"])
        expect(h.dropped).toEqual([{name: "b", missing: "a"}, {name: "c", missing: "b"}])
        expect(h.isActive("b")).toBe(false)
    })

    it("runs a phase over every active plugin before the next phase", async () => {
        const log: string[] = []
        const facet = (name: string): Facet => ({compose: ctx => void ctx.push(`compose ${name}`), wire: ctx => void ctx.push(`wire ${name}`)})
        const h = host({a: facet("a"), b: facet("b"), off: facet("off")}, name => name !== "off")
        await h.run("compose", log)
        await h.run("wire", log)
        expect(log).toEqual(["compose a", "compose b", "wire a", "wire b"])
    })

    it("collects static and phase-returned entries, gated by plugin and owner", async () => {
        const Names = GGPoint.many<string>("names")
        const Owned = GGPoint.many<string>("owned", {owner: "a"})
        const h = host({
            a: {provides: [Names.provide("a1", "a2"), Owned.provide("from a")]},
            b: {compose: () => [Names.provide("b1"), Owned.provide("from b")]},
        })
        await h.run("compose", [])
        expect(h.many(Names).map(c => [c.plugin, c.item])).toEqual([["a", "a1"], ["a", "a2"], ["b", "b1"]])
        expect(h.many(Names, name => name === "b").map(c => c.item)).toEqual(["b1"])
        expect(h.many(Owned, name => name === "b")).toEqual([])
    })

    it("tells points apart by owner and id", () => {
        const h = host({a: {provides: [GGPoint.many<string>("tiles", {owner: "a"}).provide("x")]}, b: {}})
        expect(h.many(GGPoint.many<string>("tiles", {owner: "a"})).map(c => c.item)).toEqual(["x"])
        expect(h.many(GGPoint.many<string>("tiles", {owner: "b"}))).toEqual([])
    })

    it("counts an owner without a facet in this host as on", () => {
        const Tiles = GGPoint.many<string>("tiles", {owner: "elsewhere"})
        const h = host({a: {provides: [Tiles.provide("x")]}})
        expect(h.many(Tiles).map(c => c.item)).toEqual(["x"])
        expect(h.many(Tiles, name => name !== "elsewhere")).toEqual([])
    })

    it("replaces what a phase provided when it runs again", async () => {
        const Repo = GGPoint.one<string>("repo")
        const h = host({a: {compose: () => [Repo.provide("x")]}})
        await h.run("compose", [])
        await h.run("compose", [])
        expect(h.one(Repo)).toBe("x")
    })

    it("matches points by id, sorts items by `order`", () => {
        const h = host({a: {provides: [GGPoint.many<{order: number}>("p").provide({order: 2}, {order: 1})]}})
        expect(h.many(GGPoint.many<{order: number}>("p")).map(c => c.item.order)).toEqual([1, 2])
    })

    it("allows one provider for a `one` point", () => {
        const Repo = GGPoint.one<string>("repo")
        expect(host({a: {provides: [Repo.provide("x")]}}).one(Repo)).toBe("x")
        expect(() => host({}).one(Repo)).toThrow(`No plugin provides "repo"`)
        expect(() => host({a: {provides: [Repo.provide("x")]}, b: {provides: [Repo.provide("y")]}})).toThrow(`Point "repo" takes one item; a, b provide it`)
    })

    it("builds config under each plugin's prefix and hands it to phases", async () => {
        const seen: unknown[] = []
        const a: Facet = {config: prefix => ({prefix}), compose: (_, config) => void seen.push(config)}
        const plugins = {"my-a": a as Facet & {config(prefix: string): {prefix: string}}, b: {}}
        const h = new GGPluginHost<Facet, typeof plugins>({plugins, configPrefix: name => `plugins/${name.replace(/-/g, "_")}/`})
        const tree: {"my-a": {prefix: string}} = h.configTree()
        expect(tree).toEqual({"my-a": {prefix: "plugins/my_a/"}})
        expect(h.configOf(a)).toEqual({prefix: "plugins/my_a/"})
        await h.run("compose", [])
        expect(seen).toEqual([{prefix: "plugins/my_a/"}])
    })
})
