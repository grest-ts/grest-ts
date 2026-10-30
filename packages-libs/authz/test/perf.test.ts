import {expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver} from "../src/index-node"
import {randomRequest, rng} from "./random"
import {syntheticWorld} from "./synthetic"

test("evaluate averages well under 1 ms on a 5k-workspace tenant", async () => {
    const world = syntheticWorld(rng(7))
    const authz = new GGAuthz({model: world.model, policies: world.policies, resolver: new GGAuthzMemoryResolver(world.data)})
    const r = rng(9)
    const requests = Array.from({length: 20_000}, () => randomRequest(r, world).request)
    for (const q of requests.slice(0, 2000)) await authz.evaluate(q)
    const started = performance.now()
    for (const q of requests) await authz.evaluate(q)
    expect((performance.now() - started) / requests.length).toBeLessThan(1)
})
