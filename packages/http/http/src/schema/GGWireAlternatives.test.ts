import {describe, expect, it, vi} from "vitest"
import {GGContext} from "@grest-ts/context"
import {SERVER_ERROR} from "@grest-ts/schema"
import {GGRpcRequestBuilder} from "../rpc/RpcRequest/GGRpcRequestBuilder"
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

    it("refreshes and sends only the group the client holds a value for", async () => {
        await new GGContext("wire-alternatives-client").run(async () => {
            const user = new GGHeader("authorization", {scheme: "bearer"})
            const agent = new GGHeader("x-agent-token")
            const userRecover = vi.fn(async () => {
                throw new Error("refresh failed")
            })
            user.defineClient({isStale: () => true, recover: userRecover})
            const agentRecover = vi.fn(async () => agent.set("fresh-agent"))
            agent.defineClient({isStale: () => true, recover: agentRecover})
            agent.set("stale-agent")

            const builder = new GGRpcRequestBuilder("GET", "x", {
                pathPrefix: "/",
                contract: {errors: [SERVER_ERROR]},
                middlewares: [new GGWireAlternatives([user], [agent])],
            })
            const request = await builder.createRequest(undefined)

            expect(userRecover).not.toHaveBeenCalled()
            expect(agentRecover).toHaveBeenCalledTimes(1)
            expect(request.headers).toEqual({"x-agent-token": "fresh-agent"})
        })
    })

    it("sends the first group's wires when the client holds values for several", async () => {
        await new GGContext("wire-alternatives-client").run(async () => {
            const alternatives = new GGWireAlternatives([USER], [AGENT])
            USER.set("u")
            AGENT.set("a")
            const outbound = {headers: {} as Record<string, string>}
            alternatives.update(outbound)
            expect(outbound.headers).toEqual({authorization: "Bearer u"})
        })
    })
})
