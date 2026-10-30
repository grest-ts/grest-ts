import type {GGAuthzCondition, GGAuthzMemoryData, GGAuthzModel, GGAuthzPolicies, GGAuthzRequest, GGAuthzRole, GGAuthzRule} from "../src/index-node"
import {GGAuthzRn} from "../src/index-node"

// Approval levels other than humans-only are allow in Cedar; humans-only is a forbid on workload principal types.

type Uid = {type: string, id: string}

export interface CedarWorld {
    policies: string
    entities: unknown[]
    request(request: GGAuthzRequest, facts: Record<string, boolean | undefined>): {principal: Uid, action: Uid, resource: Uid, context: Record<string, unknown>}
}

export const VIA_SLOTS = 2

const typeName = (name: string) => name.replace(/-/g, "_")
const principalType = (type: string) => typeName(type[0]!.toUpperCase() + type.slice(1))
export const resourceUid = (rn: string): Uid => {
    const [service, type] = GGAuthzRn.type(rn)!.split(":") as [string, string]
    return {type: `${typeName(service)}::${typeName(type)}`, id: rn}
}
const principalUid = (key: string): Uid => {
    const i = key.indexOf(":")
    return {type: principalType(key.slice(0, i)), id: key.slice(i + 1)}
}
const ref = (uid: Uid) => `${uid.type}::${JSON.stringify(uid.id)}`
const actions = (patterns: string[]) => `[${patterns.map(a => ref({type: "Action", id: a})).join(", ")}]`
const slots = Array.from({length: VIA_SLOTS}, (_, i) => `context.via${i}`)

function selector(s: string, x: string): string {
    if (s === "everyone") return "true"
    const [type, id] = [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)]
    return id === "*" ? `${x} is ${principalType(type)}` : `${x} in ${ref(principalUid(s))}`
}
const any = (selectors: string[] | undefined, x: string) => selectors?.length ? `(${selectors.map(s => selector(s, x)).join(" || ")})` : "false"
const hits = (principals: string[], except: string[] | undefined, x: string) => `(${any(principals, x)} && !${any(except, x)})`
const slotted = (x: string, f: (x: string) => string) => `(context has ${x.slice(8)} && ${f(x)})`
/** Every acting principal: the request's principal and each delegation slot that is set. */
const anyActor = (f: (x: string) => string) => `(${[f("principal"), ...slots.map(x => slotted(x, f))].join(" || ")})`
const applies = (principals: string[], except?: string[]) => `(${anyActor(x => hits(principals, except, x))} || ${hits(principals, except, "context.authority")})`

// Facts missing from the context are unknown: an allow needs them proven, a deny applies unless they're disproven.
type Polarity = "allow" | "deny"
const known = (f: string, value: boolean) => `(context.facts has ${f} && ${value ? "" : "!"}context.facts.${f})`
const facts = (polarity: Polarity, when?: string[], unless?: string[]) => polarity === "allow"
    ? [...(when ?? []).map(f => known(f, true)), ...(unless ?? []).map(f => known(f, false))]
    : [...(when ?? []).map(f => `!${known(f, false)}`), ...(unless ?? []).map(f => `!${known(f, true)}`)]

// An attribute is missing (unknown) unless the entity or record has it; built-ins are always present.
function attribute(key: string): {base: string, name: string, builtin: boolean} {
    const [root, name] = key.split(".") as [string, string]
    const base = root === "principal" ? "context.authority" : root === "actor" ? "principal" : root === "resource" ? "resource" : "context.ctx"
    return {base, name, builtin: (root === "principal" || root === "actor") && name === "key" || root === "resource" && name === "rn"}
}
const literal = (v: unknown): string => Array.isArray(v) ? `[${v.map(literal).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : String(v)

function condition(c: GGAuthzCondition, polarity: Polarity): string {
    const left = attribute(c.key)
    const has = (a: {base: string, name: string, builtin: boolean}) => a.builtin ? "true" : `${a.base} has ${a.name}`
    if (c.op === "present") return c.value ? `(${has(left)})` : `!(${has(left)})`
    const right = c.ref !== undefined ? attribute(c.ref) : undefined
    const L = `${left.base}.${left.name}`
    const R = right ? `${right.base}.${right.name}` : literal(c.value)
    const expr = {
        eq: `${L} == ${R}`, ne: `${L} != ${R}`, in: `${R}.contains(${L})`, notIn: `!${R}.contains(${L})`, contains: `${L}.contains(${R})`,
        startsWith: `${L} like ${JSON.stringify(String(c.value).replace(/[\\*]/g, m => `\\${m}`) + "*")}`,
        lt: `${L} < ${R}`, le: `${L} <= ${R}`, gt: `${L} > ${R}`, ge: `${L} >= ${R}`,
    }[c.op]
    const guard = [has(left), ...right ? [has(right)] : []].join(" && ")
    return polarity === "allow" ? `(${guard} && ${expr})` : `(!(${guard}) || ${expr})`
}

function conditions(polarity: Polarity, c: {when?: string[], unless?: string[], conditions?: GGAuthzCondition[]}): string[] {
    return [...facts(polarity, c.when, c.unless), ...(c.conditions ?? []).map(x => condition(x, polarity))]
}

function rule(r: GGAuthzRule, polarity: Polarity): string {
    const parts = [`action in ${actions(r.actions)}`]
    if (r.resources) parts.push(`(${r.resources.map(matcher).join(" || ")})`)
    parts.push(...conditions(polarity, r))
    return `(${parts.join(" && ")})`
}
const matcher = (m: string) => GGAuthzRn.isExact(m) ? `resource == ${ref(resourceUid(m.slice(1)))}` : GGAuthzRn.isPattern(m) ? `resource.rn like ${JSON.stringify(m)}` : `resource in ${ref(resourceUid(m))}`
const rules = (rs: GGAuthzRule[]) => rs.length ? `(${rs.map(r => rule(r, "allow")).join(" || ")})` : "false"

function roleActions(roles: GGAuthzRole[]): Map<string, string[]> {
    const byName = new Map(roles.map(r => [r.name, r]))
    const collect = (name: string): string[] => [...byName.get(name)!.actions ?? [], ...(byName.get(name)!.includes ?? []).flatMap(collect)]
    return new Map(roles.map(r => [r.name, collect(r.name)]))
}

function ancestors(data: GGAuthzMemoryData, rn: string): string[] {
    const out: string[] = []
    for (let p = data.parents?.[rn]; p !== undefined && !out.includes(p); p = data.parents?.[p]) out.push(p)
    return out
}

export function toCedar(model: GGAuthzModel, policies: GGAuthzPolicies, data: GGAuthzMemoryData, principals: string[], factNames: string[], restrictionSets: GGAuthzRule[][] = []): CedarWorld {
    const out: string[] = []
    const workload = anyActor(x => `(${(model.workloadTypes ?? []).map(t => `${x} is ${principalType(t)}`).join(" || ") || "false"})`)
    const roles = roleActions([...model.roles, ...policies.roles ?? []])

    for (const b of policies.bindings ?? []) {
        const actionsOf = roles.get(b.role)!
        const when = [selector(b.principal, "context.authority"), ...conditions("allow", b)].join(" && ")
        if (actionsOf.length) out.push(`permit(principal, action in ${actions(actionsOf)}, resource in ${ref(resourceUid(b.on))}) when { ${when} };`)
    }
    for (const p of policies.resourcePolicies ?? []) {
        for (const s of p.statements ?? []) {
            const scope = `principal, action, resource in ${ref(resourceUid(p.on))}`
            if (s.effect === "allow") out.push(`permit(${scope}) when { ${hits(s.principals, s.except, "context.authority")} && ${rule(s, "allow")} };`)
            else out.push(`forbid(${scope}) when { ${applies(s.principals, s.except)} && ${rule(s, "deny")} };`)
        }
    }
    for (const g of policies.guardrails ?? []) {
        const selected = applies(g.principals ?? ["everyone"], g.except)
        const scope = `principal, action, resource in ${ref(resourceUid(g.on))}`
        for (const r of g.deny ?? []) out.push(`forbid(${scope}) when { ${selected} && ${rule(r, "deny")} };`)
        if (g.ceiling) out.push(`forbid(${scope}) when { ${selected} && !${rules(g.ceiling)} };`)
    }
    for (const b of policies.boundaries ?? []) {
        out.push(`forbid(principal, action, resource) when { ${anyActor(x => any(b.principals, x))} && !${rules(b.allow)} };`)
    }
    const scopes = (model.tokenScopes ?? []).map(s => `(context.scopes.contains(${JSON.stringify(s.name)}) && ${rules(s.allow)})`)
    out.push(`forbid(principal, action, resource) when { context.hasScopes && !(${scopes.length ? scopes.join(" || ") : "false"}) };`)
    restrictionSets.forEach((set, i) => out.push(`forbid(principal, action, resource) when { context has restriction && context.restriction == ${i} && !${rules(set)} };`))

    for (const f of model.approvalFloor ?? []) {
        if (f.level === "humans-only") out.push(`forbid(principal, action in ${actions(f.actions)}, resource) when { ${workload} };`)
    }
    const withApprovals = (policies.resourcePolicies ?? []).filter(p => p.approvals?.length)
    for (const x of withApprovals) {
        for (const h of x.approvals!.filter(a => a.level === "humans-only")) {
            const exempt = h.locked ? [] : withApprovals
                .filter(y => y.on !== x.on && ancestors(data, y.on).includes(x.on))
                .map(y => {
                    const all = y.approvals!.flatMap(a => a.actions)
                    const strict = y.approvals!.filter(a => a.level === "humans-only").flatMap(a => a.actions)
                    return `(resource in ${ref(resourceUid(y.on))} && action in ${actions(all)}${strict.length ? ` && !(action in ${actions(strict)})` : ""})`
                })
            out.push(`forbid(principal, action in ${actions(h.actions)}, resource in ${ref(resourceUid(x.on))}) when { ${workload}${exempt.length ? ` && !(${exempt.join(" || ")})` : ""} };`)
        }
    }

    const entities: unknown[] = []
    const services = new Set(model.actions.map(a => a.name.split(":")[0]!))
    for (const s of services) entities.push({uid: {type: "Action", id: `${s}:*`}, attrs: {}, parents: []})
    for (const a of model.actions) entities.push({uid: {type: "Action", id: a.name}, attrs: {}, parents: [{type: "Action", id: `${a.name.split(":")[0]}:*`}]})
    const groups = new Set<string>()
    for (const p of principals) {
        const memberOf = data.groups?.[p] ?? []
        memberOf.forEach(g => groups.add(g))
        entities.push({uid: principalUid(p), attrs: {...data.attributes?.[p], key: p}, parents: memberOf.map(principalUid)})
    }
    for (const g of groups) entities.push({uid: principalUid(g), attrs: {key: g}, parents: []})
    const rns = new Set([...Object.keys(data.parents ?? {}), ...Object.values(data.parents ?? {})])
    for (const r of rns) {
        const parent = data.parents?.[r]
        entities.push({uid: resourceUid(r), attrs: {...data.attributes?.[r], rn: r}, parents: parent ? [resourceUid(parent)] : []})
    }

    return {
        policies: out.join("\n"),
        entities,
        request(request, known) {
            const properties = request.subject.properties
            const human = properties?.onBehalfOf
            const actor = {type: principalType(request.subject.type), id: request.subject.id}
            const via = properties?.via ?? []
            if (via.length > VIA_SLOTS) throw new Error(`At most ${VIA_SLOTS} delegation slots`)
            const restriction = properties?.restrictions ? restrictionSets.indexOf(properties.restrictions) : -1
            if (properties?.restrictions && restriction < 0) throw new Error("Restrictions must be one of the world's sets")
            return {
                principal: actor,
                action: {type: "Action", id: request.action.name},
                resource: resourceUid(request.resource.id),
                context: {
                    authority: {__entity: human ? {type: principalType(human.type), id: human.id} : actor},
                    ...Object.fromEntries(via.map((v, i) => [`via${i}`, {__entity: {type: principalType(v.type), id: v.id}}])),
                    hasScopes: properties?.scopes !== undefined,
                    scopes: properties?.scopes ?? [],
                    ...restriction >= 0 ? {restriction} : {},
                    facts: Object.fromEntries(factNames.filter(f => typeof known[f] === "boolean").map(f => [f, known[f]])),
                    ctx: Object.fromEntries(Object.entries(request.context ?? {}).filter(([, v]) => v !== undefined && v !== null)),
                },
            }
        },
    }
}
