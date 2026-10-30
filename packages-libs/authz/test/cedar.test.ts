import type * as Cedar from "@cedar-policy/cedar-wasm/nodejs"
import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver} from "../src/index-node"
import {toCedar} from "./cedar"
import {randomRequest, randomWorld, rng, type World} from "./random"
import {world as fixtureWorld} from "./world"

async function differential(world: World, requests: number, seed: number) {
    const cedar = await import("@cedar-policy/cedar-wasm/nodejs")
    const authz = new GGAuthz({model: world.model, policies: world.policies, resolver: new GGAuthzMemoryResolver(world.data)})
    const translated = toCedar(world.model, world.policies, world.data, world.principals, world.facts, world.restrictionSets)
    const id = `world-${seed}`
    const parsed = cedar.preparsePolicySet(id, {staticPolicies: translated.policies})
    if (parsed.type !== "success") throw new Error(`Cedar rejected the translation: ${JSON.stringify(parsed.errors)}\n${translated.policies}`)

    const r = rng(seed)
    const mismatches: string[] = []
    const tally = {allow: 0, approval: 0, deny: 0}
    for (let i = 0; i < requests; i++) {
        const {request, facts} = randomRequest(r, world)
        const ours = await authz.evaluate(request)
        expect(ours.context.reasons.length).toBeGreaterThan(0)
        tally[ours.context.outcome === "allow-with-approval" ? "approval" : ours.context.outcome]++
        const answer = cedar.statefulIsAuthorized({...translated.request(request, facts), preparsedPolicySetId: id, entities: translated.entities as Cedar.Entities} as Cedar.StatefulAuthorizationCall)
        if (answer.type !== "success") throw new Error(JSON.stringify(answer.errors))
        if (answer.response.diagnostics.errors.length) throw new Error(`Cedar evaluation error: ${JSON.stringify(answer.response.diagnostics.errors)}`)
        if ((answer.response.decision === "allow") !== ours.decision) {
            mismatches.push(`${JSON.stringify(request)}\n  ours: ${GGAuthz.explain(request, ours)}\n  cedar: ${answer.response.decision} via ${JSON.stringify(answer.response.diagnostics.reason)}`)
        }
    }
    return {mismatches, tally}
}

// Slow (minutes): run with `npm run test:cedar`.
describe.runIf(process.env.GG_AUTHZ_CEDAR)("differential test against Cedar", () => {
    test("fixture world, 10k random requests", async () => {
        const {mismatches, tally} = await differential(fixtureWorld, 10_000, 1)
        expect(mismatches.slice(0, 5)).toEqual([])
        expect(Math.min(tally.allow, tally.approval, tally.deny)).toBeGreaterThan(200)
    }, 120_000)

    test("40 random worlds, 500 requests each", async () => {
        const all: string[] = []
        for (let seed = 100; seed < 140; seed++) {
            const world = randomWorld(rng(seed))
            const {mismatches} = await differential(world, 500, seed)
            if (mismatches.length) all.push(`seed ${seed}: ${mismatches.length} mismatches\n${mismatches[0]}`)
        }
        expect(all.slice(0, 3)).toEqual([])
    }, 120_000)
})
