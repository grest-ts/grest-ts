import type {GGAuthzBinding, GGAuthzResourcePolicy} from "../src/index-node"
import type {World} from "./random"
import {pick, type Rng} from "./random"
import {model as fixtureModel} from "./world"

const org = "rn:acme:org:acme:org/acme"

export function syntheticWorld(r: Rng, projects = 50, perProject = 100, userCount = 300): World {
    const parents: Record<string, string> = {}
    const resources = [org]
    const workspaces: string[] = []
    const users = Array.from({length: userCount}, (_, i) => `user:u${i}`)
    const teams = Array.from({length: 20}, (_, i) => `group:team${i}`)
    const groups: Record<string, string[]> = {}
    for (const u of users) groups[u] = [pick(r, teams), ...(r() < 0.3 ? [pick(r, teams)] : []), ...(r() < 0.02 ? ["group:admins"] : []), ...(r() < 0.05 ? ["group:contractors"] : [])]
    const agents = Array.from({length: 20}, (_, i) => `agent:a${i}`)

    const bindings: GGAuthzBinding[] = [{principal: "group:admins", role: "admin", on: org}]
    const resourcePolicies: GGAuthzResourcePolicy[] = [
        {on: org, approvals: [{actions: ["vm:*"], level: "ask-once"}, {actions: ["org:*"], level: "humans-only"}]},
    ]
    for (let p = 0; p < projects; p++) {
        const project = `rn:acme:org:acme:project/p${p}`
        parents[project] = org
        resources.push(project)
        bindings.push({principal: pick(r, teams), role: "member", on: project})
        if (r() < 0.3) bindings.push({principal: pick(r, teams), role: "viewer", on: project})
        if (r() < 0.2) resourcePolicies.push({on: project, approvals: [{actions: ["secrets:*"], level: "ask", locked: true}, {actions: ["vm:TakeOverWorkspace"], level: "humans-only"}]})
        for (let w = 0; w < perProject; w++) {
            const ws = `rn:acme:vm:acme:workspace/p${p}w${w}`
            const secret = `rn:acme:secrets:acme:workspace/p${p}w${w}/secret/env`
            parents[ws] = project
            parents[secret] = ws
            resources.push(ws, secret)
            workspaces.push(ws)
            bindings.push({principal: pick(r, users), role: "owner", on: ws})
            if (r() < 0.05) resourcePolicies.push({on: ws, statements: [{effect: "allow", principals: [pick(r, users)], actions: ["vm:ReadWorkspace", "vm:StartWorkspace"]}]})
            if (r() < 0.02) resourcePolicies.push({on: ws, statements: [{effect: "deny", principals: ["everyone"], except: [pick(r, users)], actions: ["vm:*"], unless: ["mfa"]}]})
            if (r() < 0.05) resourcePolicies.push({on: ws, approvals: [{actions: ["vm:StopWorkspace"], level: pick(r, ["auto", "critical", "humans-only"] as const)}]})
        }
    }

    return {
        model: fixtureModel,
        policies: {
            bindings,
            resourcePolicies,
            boundaries: [{id: "agents", principals: ["agent:*"], allow: [{actions: ["vm:*"], resources: ["rn:acme:vm:acme:workspace/*"]}, {actions: ["secrets:Read"]}]}],
            guardrails: [
                {id: "contractors", on: org, principals: ["group:contractors"], deny: [{actions: ["vm:TakeOverWorkspace", "secrets:*"]}]},
                {id: "frozen-p0", on: "rn:acme:org:acme:project/p0", deny: [{actions: ["vm:StartWorkspace"], when: ["frozen"]}]},
            ],
        },
        data: {parents, groups},
        principals: [...users, ...agents],
        resources,
        facts: ["mfa", "frozen"],
    }
}

/** Deterministic per-row facts (true, false or unknown) so a plan and per-row authorize can be compared. */
export function rowFact(name: string, rn: string): boolean | undefined {
    let h = 2166136261
    for (const c of name + rn) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
    return [true, false, undefined][(h >>> 0) % 3]
}
