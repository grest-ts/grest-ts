import {describe, expect, it} from "vitest"
import {GGHeader} from "./GGHeader"
import {GGWireAlternatives} from "./GGWireAlternatives"
import {checkWireConflicts} from "../server/checkers/checkWireConflicts"
import {checkWiresImplemented} from "../server/checkers/checkWiresImplemented"

const USER = new GGHeader("authorization", {scheme: "bearer"})
const AGENT = new GGHeader("x-agent-token")

describe("GGWireAlternatives", () => {

    it("needs at least two non-empty groups", () => {
        expect(() => new GGWireAlternatives([USER])).toThrow(/two non-empty groups/)
        expect(() => new GGWireAlternatives([USER], [])).toThrow(/two non-empty groups/)
    })

    it("declares every group's headers, for CORS and docs", () => {
        expect(Object.keys(new GGWireAlternatives([USER], [AGENT]).headers)).toEqual(["authorization", "x-agent-token"])
    })

    it("conflicts when two groups read the same header", () => {
        const other = new GGHeader("authorization")
        const schema = {name: "Clash", apiMiddlewares: [new GGWireAlternatives([USER], [other])]}
        expect(() => checkWireConflicts([schema], [])).toThrow(/same header "authorization"/)
    })

    it("refuses at start a group without a .define()d wire", () => {
        const schema = {name: "Ambient", apiMiddlewares: [new GGWireAlternatives([USER], [AGENT])]}
        expect(() => checkWiresImplemented([schema], [])).toThrow(/needs a .define\(\)d wire[\s\S]*Ambient/)
    })

    it("has no active wires before a request chose a group", () => {
        expect(new GGWireAlternatives([USER], [AGENT]).activeWires()).toEqual([])
    })
})
