import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzPolicies, type GGAuthzRule, type GGAuthzSubject, IsGGAuthzRule} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const repo = (id: string) => `rn:acme:git:acme:repo/${id}`

const model = {
    partition: "acme",
    actions: ["git:Read", "git:Push", "git:Delete"].map(name => ({name, resourceTypes: ["git:repo"]})),
    roles: [{name: "writer", actions: ["git:*"]}],
    workloadTypes: ["agent", "client"],
    approvalFloor: [{actions: ["git:Delete"], level: "ask" as const}],
}
const data = {parents: {[repo("site")]: org, [repo("prod")]: org}}

function engine(boundary: GGAuthzRule[], extra: Partial<GGAuthzPolicies> = {}) {
    const policies: GGAuthzPolicies = {
        bindings: [{principal: "user:ann", role: "writer", on: org}],
        boundaries: [{id: "agents", principals: ["agent:*"], allow: boundary}],
        ...extra,
    }
    return new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data)})
}

const agent = (restrictions?: GGAuthzRule[]): GGAuthzSubject => ({type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}, restrictions}})
const human: GGAuthzSubject = {type: "user", id: "ann"}
const decide = (authz: GGAuthz, subject: GGAuthzSubject, action: string, id = repo("site")) =>
    authz.evaluate({subject, action: {name: action}, resource: {type: "git:repo", id}})

describe("approval levels on ceiling rules", () => {
    test("a workload through a rule with a level needs that approval; without one it is allowed", async () => {
        const authz = engine([{actions: ["git:Read"]}, {actions: ["git:Push"], approval: "ask-once"}])
        expect((await decide(authz, agent(), "git:Read")).context).toMatchObject({outcome: "allow", approval: "auto"})
        const push = await decide(authz, agent(), "git:Push")
        expect(push.context).toMatchObject({outcome: "allow-with-approval", approval: "ask-once"})
        expect(push.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "ask-once", message: "boundary agents"}))
    })

    test("rules within one ceiling are a union: the least strict matching rule counts", async () => {
        const authz = engine([
            {actions: ["git:Push"], approval: "critical"},
            {actions: ["git:Push"], resources: [repo("site")], approval: "ask-once"},
        ])
        expect((await decide(authz, agent(), "git:Push", repo("site"))).context.approval).toBe("ask-once")
        expect((await decide(authz, agent(), "git:Push", repo("prod"))).context.approval).toBe("critical")
    })

    test("ceilings intersect: the strictest one counts", async () => {
        const authz = engine([{actions: ["git:Push"], approval: "ask-once"}])
        expect((await decide(authz, agent([{actions: ["git:Push"], approval: "dangerous"}]), "git:Push")).context.approval).toBe("dangerous")
        expect((await decide(authz, agent([{actions: ["git:Push"]}]), "git:Push")).context.approval).toBe("ask-once")
    })

    test("guardrail ceilings carry levels too", async () => {
        const authz = engine([{actions: ["git:*"]}], {guardrails: [{id: "prod", on: repo("prod"), principals: ["agent:*"], ceiling: [{actions: ["git:Push"], approval: "ask"}]}]})
        expect((await decide(authz, agent(), "git:Push", repo("prod"))).context.approval).toBe("ask")
        expect((await decide(authz, agent(), "git:Push", repo("site"))).context.approval).toBe("auto")
    })

    test("a ceiling level never lowers the locked floor", async () => {
        const authz = engine([{actions: ["git:Delete"], approval: "ask-once"}])
        expect((await decide(authz, agent(), "git:Delete")).context).toMatchObject({approval: "ask", reasons: expect.arrayContaining([expect.objectContaining({layer: "approval", locked: true})])})
    })

    test("a level never widens: an action outside the ceiling is still denied", async () => {
        const authz = engine([{actions: ["git:Read"], approval: "ask"}])
        expect((await decide(authz, agent(), "git:Push")).decision).toBe(false)
    })

    test("humans get no level, even from a ceiling that applies to them", async () => {
        const authz = engine([{actions: ["git:*"]}], {guardrails: [{id: "all", on: org, ceiling: [{actions: ["git:*"], approval: "critical"}]}]})
        const d = await decide(authz, human, "git:Push")
        expect(d.context.outcome).toBe("allow")
        expect(d.context.approval).toBeUndefined()
    })

    test("a rule can't carry humans-only: deny is leaving the action out", () => {
        expect(IsGGAuthzRule.is({actions: ["git:Push"], approval: "humans-only"})).toBe(false)
        expect(IsGGAuthzRule.is({actions: ["git:Push"], approval: "dangerous"})).toBe(true)
    })
})
