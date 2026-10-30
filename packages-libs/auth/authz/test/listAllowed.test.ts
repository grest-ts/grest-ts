import {afterEach, describe, expect, test, vi} from "vitest"
import {type GGAuthzListRequest, GGAuthz, GGAuthzMemoryResolver, IsGGAuthzPlan, GGAuthzRn} from "../src/index-node"
import {randomRequest, randomWorld, rng, type World} from "./random"
import {rowFact, syntheticWorld} from "./synthetic"
import {filterAsync, subject} from "./util"
import * as fixture from "./world"

function engine(w: World) {
    const resolver = new GGAuthzMemoryResolver(w.data)
    return {resolver, authz: new GGAuthz({model: w.model, policies: w.policies, resolver, facts: (name, req) => rowFact(name, req.resource.id)})}
}

async function compare(w: World, requests: {subject: GGAuthzListRequest["subject"], context?: Record<string, unknown>}[]) {
    const {authz, resolver} = engine(w)
    let checked = 0
    for (const {subject: s, context} of requests) {
        for (const a of w.model.actions) {
            for (const type of a.resourceTypes) {
                const plan = await authz.listAllowed({subject: s, action: {name: a.name}, resource: {type}, context})
                expect(IsGGAuthzPlan.is(plan)).toBe(true)
                const listed = GGAuthz.applyPlan(plan, w.resources, {resolver, facts: rowFact})
                const rows = w.resources.filter(rn => GGAuthzRn.type(rn) === type)
                const expected = await filterAsync(rows, async rn => (await authz.evaluate({subject: s, action: {name: a.name}, resource: {type, id: rn}, context})).decision)
                expect({subject: s, action: a.name, listed}).toEqual({subject: s, action: a.name, listed: expected})
                checked++
            }
        }
    }
    return checked
}

afterEach(() => vi.restoreAllMocks())

describe("listAllowed plan = per-row authorize", () => {
    test("fixture world", async () => {
        const subjects = [
            ...fixture.users.map(u => subject(u)),
            ...fixture.agents.map(a => subject(a)),
            ...fixture.users.map(u => subject("agent:ws-ann", u)),
            subject("client:ci-tool", "user:ann", ["workspaces:operate", "repos"]),
        ]
        expect(await compare(fixture.world, subjects.map(subject => ({subject})))).toBeGreaterThan(100)
    })

    test("random worlds", async () => {
        for (let seed = 200; seed < 240; seed++) {
            const r = rng(seed)
            const w = randomWorld(r)
            await compare(w, Array.from({length: 12}, () => randomRequest(r, w).request))
        }
    }, 120_000)
})

describe("listAllowed over 5k synthetic workspaces", () => {
    const w = syntheticWorld(rng(7))
    const {authz, resolver} = engine(w)
    const workspaces = w.resources.filter(rn => GGAuthzRn.type(rn) === "vm:workspace")

    test.each([
        ["a team member", subject("user:u1")],
        ["an agent acting for a member", subject("agent:a1", "user:u2")],
        ["an admin's agent", subject("agent:a3", Object.keys(w.data.groups!).find(u => w.data.groups![u]!.includes("group:admins"))!)],
    ])("%s: plan without per-row evaluation", async (_, s) => {
        expect(workspaces.length).toBe(5000)
        const decide = vi.spyOn(GGAuthz.prototype as any, "decideWith")
        const ancestors = vi.spyOn(resolver, "ancestors")
        for (const action of ["vm:StopWorkspace", "vm:TakeOverWorkspace"]) {
            const plan = await authz.listAllowed({subject: s, action: {name: action}, resource: {type: "vm:workspace"}})
            expect(decide).not.toHaveBeenCalled()
            expect(ancestors.mock.calls.length).toBeLessThanOrEqual(w.policies.resourcePolicies!.length)
            expect(plan.include.length + plan.exclude.length).toBeLessThan(500)

            ancestors.mockClear()
            const listed = GGAuthz.applyPlan(plan, workspaces, {resolver, facts: rowFact})
            expect(decide).not.toHaveBeenCalled()
            const expected = await filterAsync(workspaces, async rn => (await authz.evaluate({subject: s, action: {name: action}, resource: {type: "vm:workspace", id: rn}})).decision)
            expect(listed).toEqual(expected)
            decide.mockClear()
            ancestors.mockClear()
        }
    }, 60_000)
})
