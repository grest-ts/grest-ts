import {type GGAuthzRequest, GGAuthz, GGAuthzMemoryResolver, GGAuthzRn} from "../src/index-node"
import {pick, randomRequest, rng} from "./random"
import {rowFact, syntheticWorld} from "./synthetic"
import {subject} from "./util"

const world = syntheticWorld(rng(7))
const resolver = new GGAuthzMemoryResolver(world.data)
const built = performance.now()
const authz = new GGAuthz({model: world.model, policies: world.policies, resolver})
const buildMs = performance.now() - built

const r = rng(42)
const requests: GGAuthzRequest[] = Array.from({length: 100_000}, () => randomRequest(r, world).request)
for (const q of requests.slice(0, 10_000)) await authz.evaluate(q)

const samples: number[] = []
let allowed = 0
const started = performance.now()
for (const q of requests) {
    const t = performance.now()
    if ((await authz.evaluate(q)).decision) allowed++
    samples.push(performance.now() - t)
}
const totalMs = performance.now() - started
samples.sort((a, b) => a - b)
const pct = (p: number) => samples[Math.floor(samples.length * p)]!.toFixed(4)

const workspaces = world.resources.filter(rn => GGAuthzRn.type(rn) === "vm:workspace")
const listFor = async (s: GGAuthzRequest["subject"]) => {
    const t0 = performance.now()
    const plan = await authz.listAllowed({subject: s, action: {name: "vm:StopWorkspace"}, resource: {type: "vm:workspace"}})
    const t1 = performance.now()
    const rows = GGAuthz.applyPlan(plan, workspaces, {resolver, facts: rowFact})
    const t2 = performance.now()
    return {plan: (t1 - t0).toFixed(3), apply: (t2 - t1).toFixed(2), filters: plan.include.length + plan.exclude.length, rows: rows.length}
}

console.log(JSON.stringify({
    world: {
        resources: world.resources.length,
        workspaces: workspaces.length,
        principals: world.principals.length,
        bindings: world.policies.bindings!.length,
        resourcePolicies: world.policies.resourcePolicies!.length,
        buildMs: buildMs.toFixed(1),
    },
    evaluate: {
        requests: requests.length,
        allowed,
        meanMs: (totalMs / requests.length).toFixed(4),
        p50Ms: pct(0.5),
        p99Ms: pct(0.99),
        maxMs: samples[samples.length - 1]!.toFixed(3),
    },
    listAllowed: {
        member: await listFor(subject(pick(r, world.principals.filter(p => p.startsWith("user:"))))),
        agentForMember: await listFor(subject("agent:a1", "user:u2")),
    },
}, null, 2))
