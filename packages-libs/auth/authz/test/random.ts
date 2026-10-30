import type {GGAuthzApprovalLevel, GGAuthzCondition, GGAuthzMemoryData, GGAuthzModel, GGAuthzPolicies, GGAuthzRequest, GGAuthzRole, GGAuthzRule} from "../src/index-node"
import {GG_AUTHZ_APPROVAL_LEVELS, GGAuthzRn} from "../src/index-node"
import {entity} from "./util"

export type Rng = () => number

export function rng(seed: number): Rng {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
const some = <T>(r: Rng, xs: readonly T[], max: number): T[] => [...new Set(Array.from({length: 1 + Math.floor(r() * max)}, () => pick(r, xs)))]
const maybe = <T>(r: Rng, p: number, f: () => T): T | undefined => r() < p ? f() : undefined
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1))

export interface World {
    model: GGAuthzModel
    policies: GGAuthzPolicies
    data: GGAuthzMemoryData
    principals: string[]
    resources: string[]
    facts: string[]
    /** Per-request restrictions a request may carry: one of these arrays, by reference. */
    restrictionSets?: GGAuthzRule[][]
}

const candidateCache = new WeakMap<World, Map<string, string[]>>()

function candidatesFor(w: World): Map<string, string[]> {
    let map = candidateCache.get(w)
    if (!map) {
        map = new Map(w.model.actions.map(a => [a.name, w.resources.filter(x => a.resourceTypes.includes(GGAuthzRn.type(x)!))]))
        candidateCache.set(w, map)
    }
    return map
}

export function randomRequest(r: Rng, w: World): {request: GGAuthzRequest, facts: Record<string, boolean | undefined>} {
    const users = w.principals.filter(p => p.startsWith("user:"))
    const agents = w.principals.filter(p => p.startsWith("agent:"))
    const clients = w.principals.filter(p => p.startsWith("client:"))
    const scopeNames = [...(w.model.tokenScopes ?? []).map(s => s.name), "unknown-scope"]
    const roll = r()
    let actor: string
    let onBehalfOf: string | undefined
    let scopes: string[] | undefined
    if (roll < 0.35) actor = pick(r, users)
    else if (roll < 0.6) [actor, onBehalfOf] = [pick(r, agents), pick(r, users)]
    else if (roll < 0.72) actor = pick(r, agents)
    else if (roll < 0.9) [actor, onBehalfOf, scopes] = [pick(r, clients.length ? clients : users), pick(r, users), r() < 0.15 ? [] : some(r, scopeNames, 3)]
    else [actor, scopes] = [pick(r, users), some(r, scopeNames, 2)]
    const via = agents.includes(actor) || clients.includes(actor) ? r() < 0.4 ? some(r, [...agents, ...clients], 2).filter(v => v !== actor) : undefined : undefined
    const restrictions = w.restrictionSets?.length && r() < 0.2 ? pick(r, w.restrictionSets) : undefined

    const candidates = candidatesFor(w)
    const action = pick(r, w.model.actions.filter(a => candidates.get(a.name)!.length))
    const resource = pick(r, candidates.get(action.name)!)
    const facts = Object.fromEntries(w.facts.flatMap(f => {
        const roll = r()
        return roll < 0.4 ? [[f, true]] : roll < 0.75 ? [[f, false]] : []
    }))
    const context: Record<string, unknown> = {...facts}
    if (r() < 0.6) context.level = int(r, 0, 3)
    if (r() < 0.6) context.zone = pick(r, ZONES)
    return {
        request: {
            subject: {...entity(actor), properties: onBehalfOf || scopes || restrictions || via?.length ? {onBehalfOf: onBehalfOf ? entity(onBehalfOf) : undefined, scopes, via: via?.length ? via.map(entity) : undefined, restrictions} : undefined},
            action: {name: action.name},
            resource: {type: GGAuthzRn.type(resource)!, id: resource},
            context,
        },
        facts,
    }
}

export function randomWorld(r: Rng, size = 1): World {
    const parents: Record<string, string> = {}
    const org = "rn:acme:org:acme:org/acme"
    const resources = [org]
    const add = (rn: string, parent: string) => {
        parents[rn] = parent
        resources.push(rn)
    }
    for (let p = 0; p < int(r, 2, 3) * size; p++) {
        const project = `rn:acme:org:acme:project/p${p}`
        add(project, org)
        for (let w = 0; w < int(r, 1, 4); w++) {
            const ws = `rn:acme:vm:acme:workspace/p${p}w${w}`
            add(ws, project)
            if (r() < 0.5) add(`rn:acme:secrets:acme:workspace/p${p}w${w}/secret/env`, ws)
        }
        for (let s = 0; s < int(r, 0, 2); s++) add(`rn:acme:secrets:acme:secret/p${p}s${s}`, project)
        if (r() < 0.7) add(`rn:acme:git:acme:repo/p${p}`, project)
    }

    const actions = [
        {name: "vm:Read", resourceTypes: ["vm:workspace"]},
        {name: "vm:Stop", resourceTypes: ["vm:workspace"]},
        {name: "secrets:Read", resourceTypes: ["secrets:secret"]},
        {name: "secrets:Write", resourceTypes: ["secrets:secret"]},
        {name: "git:Push", resourceTypes: ["git:repo"]},
        {name: "org:Manage", resourceTypes: ["org:org", "org:project"]},
    ]
    const patterns = [...actions.map(a => a.name), "vm:*", "secrets:*", "git:*", "org:*"]
    const facts = ["f1", "f2", "f3"]
    const matchers = [...resources, ...resources.map(rn => `=${rn}`), "rn:acme:vm:acme:workspace/*", "rn:acme:secrets:acme:*", "rn:acme:secrets:acme:secret/*", "rn:acme:git:*", "rn:acme:*"]

    const users = Array.from({length: 5 * size}, (_, i) => `user:u${i}`)
    const agents = ["agent:a0", "agent:a1", "agent:a2"]
    const clients = ["client:c0"]
    const groupIds = ["group:g0", "group:g1", "group:g2", "group:g3"]
    const groups: Record<string, string[]> = {}
    for (const p of [...users, ...agents, ...clients]) groups[p] = groupIds.filter(() => r() < 0.3)
    const selectors = [...users, ...agents, ...clients, ...groupIds, "everyone", "agent:*", "user:*", "client:*"]

    const attributes: Record<string, Record<string, unknown>> = {}
    const principals = [...users, ...agents, ...clients]
    for (const p of principals) attributes[p] = attrs(r, {team: () => pick(r, TEAMS), level: () => int(r, 0, 3), dept: () => pick(r, DEPTS)})
    for (const rn of resources) attributes[rn] = attrs(r, {env: () => pick(r, ENVS), team: () => pick(r, TEAMS), level: () => int(r, 0, 3), tags: () => some(r, [...TEAMS, "x"], 2), owner: () => pick(r, principals)})

    const conditions = () => ({when: maybe(r, 0.25, () => some(r, facts, 2)), unless: maybe(r, 0.2, () => some(r, facts, 1)), conditions: maybe(r, 0.3, () => Array.from({length: int(r, 1, 2)}, () => condition(r)))})
    const rule = (): GGAuthzRule => ({actions: some(r, patterns, 3), resources: maybe(r, 0.4, () => some(r, matchers, 2)), ...conditions()})
    const roles: GGAuthzRole[] = Array.from({length: int(r, 3, 5)}, (_, i) => ({name: `role${i}`, actions: some(r, patterns, 4)}))
    const tenantRoles: GGAuthzRole[] = []
    for (let i = 0; i < int(r, 0, 3); i++) {
        const includes = some(r, [...roles, ...tenantRoles].map(x => x.name), 2)
        tenantRoles.push({name: `custom${i}`, actions: maybe(r, 0.5, () => some(r, patterns, 2)), includes})
    }
    const roleNames = [...roles, ...tenantRoles].map(x => x.name)

    return {
        model: {
            partition: "acme",
            actions,
            roles,
            tokenScopes: [{name: "s0", allow: [rule()]}, {name: "s1", allow: [rule(), rule()]}],
            workloadTypes: ["agent"],
            approvalFloor: r() < 0.4 ? [{actions: some(r, patterns, 2), level: pick(r, GG_AUTHZ_APPROVAL_LEVELS) as GGAuthzApprovalLevel}] : [],
        },
        policies: {
            roles: tenantRoles,
            bindings: Array.from({length: int(r, 6, 14) * size}, () => ({principal: pick(r, selectors), role: pick(r, roleNames), on: pick(r, resources), ...conditions()})),
            resourcePolicies: Array.from({length: int(r, 3, 8) * size}, () => ({
                on: pick(r, resources),
                statements: Array.from({length: int(r, 0, 2)}, () => ({
                    effect: r() < 0.6 ? "allow" as const : "deny" as const,
                    principals: some(r, selectors, 2),
                    except: maybe(r, 0.3, () => some(r, selectors, 2)),
                    ...rule(),
                })),
                approvals: Array.from({length: int(r, 0, 2)}, () => ({actions: some(r, patterns, 2), level: pick(r, GG_AUTHZ_APPROVAL_LEVELS) as GGAuthzApprovalLevel, locked: maybe(r, 0.4, () => true)})),
            })),
            boundaries: Array.from({length: int(r, 0, 2)}, (_, i) => ({id: `b${i}`, principals: some(r, ["agent:*", ...agents, ...groupIds, "client:*"], 2), allow: Array.from({length: int(r, 1, 3)}, rule)})),
            guardrails: Array.from({length: int(r, 0, 3)}, (_, i) => ({
                id: `g${i}`,
                on: pick(r, resources),
                principals: maybe(r, 0.6, () => some(r, selectors, 2)),
                except: maybe(r, 0.3, () => some(r, selectors, 1)),
                deny: maybe(r, 0.7, () => Array.from({length: int(r, 1, 2)}, rule)),
                ceiling: maybe(r, 0.4, () => Array.from({length: int(r, 0, 2)}, rule)),
            })),
        },
        data: {parents, groups, attributes},
        principals,
        resources,
        facts,
        restrictionSets: [[rule()], [rule(), rule()]],
    }
}

const TEAMS = ["red", "blue"]
const ENVS = ["dev", "prod"]
const DEPTS = ["eng", "ops"]
const ZONES = ["eu", "us"]

function attrs(r: Rng, make: Record<string, () => unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(make).filter(() => r() < 0.6).map(([k, f]) => [k, f()]))
}

// Typed keys keep the conditions free of type errors, which Cedar reports as errors rather than unknowns.
const NUMBERS = ["principal.level", "actor.level", "resource.level", "context.level"]
const STRINGS = ["principal.team", "actor.team", "principal.dept", "resource.team", "resource.env", "context.zone"]
const KEYS = ["principal.key", "actor.key"]

function condition(r: Rng): GGAuthzCondition {
    const roll = r()
    if (roll < 0.25) {
        const key = pick(r, NUMBERS)
        const op = pick(r, ["eq", "ne", "lt", "le", "gt", "ge", "in", "notIn", "present"] as const)
        if (op === "present") return {key, op, value: r() < 0.5}
        if (op === "in" || op === "notIn") return {key, op, value: some(r, [0, 1, 2, 3], 2)}
        return r() < 0.3 ? {key, op, ref: pick(r, NUMBERS.filter(k => k !== key))} : {key, op, value: int(r, 0, 3)}
    }
    if (roll < 0.6) {
        const key = pick(r, STRINGS)
        const values = key.endsWith("env") ? ENVS : key.endsWith("dept") ? DEPTS : key.endsWith("zone") ? ZONES : TEAMS
        const op = pick(r, ["eq", "ne", "in", "notIn", "startsWith", "present"] as const)
        if (op === "present") return {key, op, value: r() < 0.5}
        if (op === "in" || op === "notIn") return {key, op, value: some(r, values, 2)}
        if (op === "startsWith") return {key, op, value: pick(r, values).slice(0, 1)}
        return r() < 0.3 && values === TEAMS ? {key, op, ref: pick(r, STRINGS.filter(k => k !== key && k.endsWith("team")))} : {key, op, value: pick(r, values)}
    }
    if (roll < 0.8) return r() < 0.5 ? {key: "resource.tags", op: "contains", value: pick(r, TEAMS)} : {key: "resource.tags", op: "contains", ref: pick(r, ["principal.team", "actor.team"])}
    return {key: "resource.owner", op: pick(r, ["eq", "ne"] as const), ref: pick(r, KEYS)}
}
