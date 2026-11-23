import {GGContext} from "@grest-ts/context"
import type {GGAuthorityHandler} from "@grest-ts/http"
import {GGContractClass, GGPermissionChecker, type GGRequirement, IsObject, IsString} from "@grest-ts/schema"
import {FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {
    APPROVAL_REQUIRED,
    GG_AUTHZ_SUBJECT,
    GGAuthz,
    GGAuthzAuthority,
    GGAuthzMemoryResolver,
    type GGAuthzApprovalNeed,
    type GGAuthzAuthorityConfig,
    type GGAuthzDecided,
    type GGAuthzSubject,
    INSUFFICIENT_SCOPE,
    STEP_UP_REQUIRED,
} from "../src/index-node"
import {as, check} from "./util"
import {data, Git, model, Org, policies, rn, Secrets, Vm} from "./world"

const engine = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data)})
const factsAsked: string[] = []

const authority = new GGAuthzAuthority({
    partition: "acme",
    tenantType: Org.types.org,
    tenant: () => "acme",
    engine: async () => engine,
    facts: (action, resource) => {
        factsAsked.push(`${action} ${resource.rn}`)
        return action === Git.Read.name ? {repoVisible: resource.id === "site"} : undefined
    },
    contexts: {callingWorkspace: () => "dan-1"},
})
const workspaces: Record<string, string> = {"ann-1": rn.web, "ben-1": rn.web, "cleo-1": rn.ml, "dan-1": rn.ml}
const workspaceLoads: string[] = []
authority.register(Vm.types.workspace, (tenant, id) => {
    workspaceLoads.push(id)
    return tenant === "acme" && workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}, row: {id}} : undefined
})
authority.register(Org.types.project, (_tenant, id) => id === "web" || id === "ml" ? {properties: {ancestors: [rn.org]}} : undefined)
authority.register(Git.types.repo, (_tenant, id) => id === "site" || id === "models" ? {properties: {ancestors: [id === "site" ? rn.web : rn.ml, rn.org]}} : undefined)

const ann: GGAuthzSubject = {type: "user", id: "ann"}

const fail = (p: Promise<unknown>) => p.then(() => undefined, e => e)

// What the HTTP pipeline does for a contract call: authorizes it with its requirements, then runs the handler (`fn`).
const inCall = <T>(on: GGAuthzAuthority, subject: GGAuthzSubject, call: {api: string, method: string}, requirements: readonly GGRequirement[], input: unknown, fn?: () => Promise<T>) =>
    as(subject, async () => {
        await on.authorize(call, requirements, input)
        return fn?.()
    })

// GGAuthzAuthority matches @grest-ts/http's handler by shape (src may not depend on http); this keeps the two in step.
void (authority satisfies GGAuthorityHandler)

describe("GGAuthzAuthority", () => {
    test("reads the id from the input, loads the row and decides", async () => {
        await as(ann, () => check(authority, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"}))
        expect(FORBIDDEN.is(await fail(as(ann, () => check(authority, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "cleo-1"}))))).toBe(true)
    })

    test("a field may be a path into the input", async () => {
        await as(ann, () => check(authority, Vm.StopWorkspace.on("target.workspaceId"), {target: {workspaceId: "ann-1"}}))
        expect(FORBIDDEN.is(await fail(as(ann, () => check(authority, Vm.StopWorkspace.on("target.workspaceId"), {target: {workspaceId: "cleo-1"}}))))).toBe(true)
        const save = Org.ManageMembers.on(Org.types.project, "at.projectId").orCreateOn(Org.types.org)
        expect((await fail(as(ann, () => check(authority, save, {at: {}})))).getDebugContext().debugMessage).toContain("on rn:acme:org:acme:org/acme")
    })

    test("a missing row is NOT_FOUND, and so is a hidden denial", async () => {
        expect(NOT_FOUND.is(await fail(as(ann, () => check(authority, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "nope"}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => check(authority, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "bad/id"}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => check(authority, Vm.StopWorkspace.on("workspaceId").hide(), {workspaceId: "cleo-1"}))))).toBe(true)
    })

    test("the tenant type without an id is the caller's tenant; another tenant's id is NOT_FOUND", async () => {
        expect(FORBIDDEN.is(await fail(as(ann, () => check(authority, Org.ManageMembers.on(Org.types.org), {}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => check(authority, Org.ManageMembers.on(Org.types.org, "orgId"), {orgId: "other"}))))).toBe(true)
        await expect(as(ann, () => check(authority, Vm.StopWorkspace.on(Vm.types.workspace), {}))).rejects.toThrow("only org:org")
    })

    test("an upsert checks the existing resource, or the parent when creating", async () => {
        const save = Org.ManageMembers.on(Org.types.project, "projectId").orCreateOn(Org.types.org, "orgId")
        const creating = await fail(as(ann, () => check(authority, save, {orgId: "acme"})))
        expect(creating.getDebugContext().debugMessage).toContain("on rn:acme:org:acme:org/acme")
        const updating = await fail(as(ann, () => check(authority, save, {projectId: "web", orgId: "acme"})))
        expect(updating.getDebugContext().debugMessage).toContain("on rn:acme:org:acme:project/web")
        await as({type: "user", id: "cleo"}, () => check(authority, save, {projectId: "web", orgId: "acme"}))
        const onTenant = Org.ManageMembers.on(Org.types.project, "projectId").orCreateOn(Org.types.org)
        expect((await fail(as(ann, () => check(authority, onTenant, {})))).getDebugContext().debugMessage).toContain("on rn:acme:org:acme:org/acme")
        await expect(as(ann, () => authority.assert(Secrets.Read, {type: Secrets.types.secret, id: "x"}))).rejects.toThrow("No loader registered for secrets:secret")
    })

    test("hides hides a refusal, explains says why; a requirement's .hide() wins without asking; can/peek never ask", async () => {
        const asked: string[] = []
        const shaping = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            facts: () => ({hideMe: true}),
            hides: async r => {
                asked.push(`${r.action} ${r.resource.id} ${r.refusal} ${r.facts?.hideMe} ${r.decision.context.reasons.length > 0}`)
                return r.resource.id === "cleo-1"
            },
            explains: async r => new FORBIDDEN({displayMessage: `why ${r.resource.id}`}),
        })
        shaping.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        const err = await fail(as(ann, () => check(shaping, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "dan-1"})))
        expect(FORBIDDEN.is(err) && err.context?.displayMessage).toBe("why dan-1")
        expect(NOT_FOUND.is(await fail(as(ann, () => check(shaping, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "cleo-1"}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => check(shaping, Vm.StopWorkspace.on("workspaceId").hide(), {workspaceId: "dan-1"}))))).toBe(true)
        expect(await as(ann, () => shaping.can(Vm.StopWorkspace, {type: Vm.types.workspace, id: "dan-1"}))).toBe(false)
        expect(asked).toEqual([`${Vm.StopWorkspace.name} dan-1 FORBIDDEN true true`, `${Vm.StopWorkspace.name} cleo-1 FORBIDDEN true true`])
    })

    test("a throw in hides or explains is the answer, heard as the refusal's", async () => {
        const heard: GGAuthzDecided[] = []
        const down = new SERVER_ERROR({debugMessage: "GitHub down"})
        const broken = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            hides: async r => {
                if (r.resource.id === "cleo-1") throw down
                return false
            },
            explains: async () => { throw down },
            decided: e => { heard.push(e) },
        })
        broken.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        expect(await fail(as(ann, () => broken.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "cleo-1"})))).toBe(down)
        expect(await fail(as(ann, () => broken.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "dan-1"})))).toBe(down)
        expect(heard.map(e => e.outcome === "denied" && [e.refusal, e.hidden, e.error === down])).toEqual([["FORBIDDEN", false, true], ["FORBIDDEN", false, true]])
    })

    test("decided hears each decision once its answer is final, with the error the caller got; can/peek never reach it", async () => {
        const heard: GGAuthzDecided[] = []
        const auditing = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            hides: async r => r.resource.id === "cleo-1",
            explains: async () => new FORBIDDEN({displayMessage: "why"}),
            decided: event => {
                heard.push(event)
                throw new Error("audit down")
            },
        })
        auditing.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        const secret = {type: Secrets.types.secret, id: "env", properties: {ancestors: [rn.ws("ann-1"), rn.web, rn.org]}}
        const scoped: GGAuthzSubject = {type: "client", id: "ci-tool", properties: {onBehalfOf: {type: "user", id: "ann"}, scopes: ["workspaces:read"]}}
        const stop = Vm.StopWorkspace.on("workspaceId")
        const err = await fail(inCall(auditing, ann, {api: "VmApi", method: "stop"}, [stop], {workspaceId: "dan-1"}))
        expect(FORBIDDEN.is(err) && err.context?.displayMessage).toBe("why")
        expect(NOT_FOUND.is(await fail(as(ann, () => check(auditing, stop, {workspaceId: "cleo-1"}))))).toBe(true)
        await as(ann, () => check(auditing, stop, {workspaceId: "ann-1"}))
        expect(STEP_UP_REQUIRED.is(await fail(as(ann, () => auditing.assert(Secrets.Write, secret))))).toBe(true)
        expect(INSUFFICIENT_SCOPE.is(await fail(as(scoped, () => auditing.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-1"}))))).toBe(true)
        expect(await as(ann, () => auditing.can(Vm.StopWorkspace, {type: Vm.types.workspace, id: "dan-1"}))).toBe(false)
        const denied = (e: GGAuthzDecided) => e.outcome === "denied" ? [e.refusal, e.hidden, (e.error as {type: string}).type] : []
        expect(heard.map(e => e.check === "action" && [e.action, e.resource.id, e.subject.id, e.call?.method, e.outcome, ...denied(e)])).toEqual([
            [Vm.StopWorkspace.name, "dan-1", "ann", "stop", "denied", "FORBIDDEN", false, "FORBIDDEN"],
            [Vm.StopWorkspace.name, "cleo-1", "ann", "test", "denied", "FORBIDDEN", true, "NOT_FOUND"],
            [Vm.StopWorkspace.name, "ann-1", "ann", "test", "allowed"],
            [Secrets.Write.name, "env", "ann", undefined, "denied", "STEP_UP_REQUIRED", false, "STEP_UP_REQUIRED"],
            [Vm.StopWorkspace.name, "ann-1", "ci-tool", undefined, "denied", "INSUFFICIENT_SCOPE", false, "INSUFFICIENT_SCOPE"],
        ])
    })

    test("decided hears a grant with its role and principal, and assertHolds once with what was missing; an async listener's rejection is ignored", async () => {
        const heard: GGAuthzDecided[] = []
        const auditing = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            decided: async event => {
                heard.push(event)
                throw new Error("audit down")
            },
            // Grants and holds checks are answered as they are: asking here would fail them.
            hides: () => { throw new Error("hides asked") },
        })
        auditing.register(Org.types.project, (_tenant, id) => id === "web" ? {properties: {ancestors: [rn.org]}} : undefined)
        auditing.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        const web = {type: Org.types.project, id: "web"}
        await as(ann, () => auditing.authorizeGrant("viewer", "user:ben", web))
        expect(FORBIDDEN.is(await fail(as(ann, () => auditing.authorizeGrant("admin", "user:ben", web))))).toBe(true)
        const ws = {type: Vm.types.workspace, id: "ann-1"}
        const err = await fail(as(ann, () => auditing.assertHolds([Vm.ReadWorkspace, Vm.TakeOverWorkspace], ws, {displayMessage: "not yours to give"})))
        expect(FORBIDDEN.is(err) && err.context?.displayMessage).toBe("not yours to give")
        const grantAction = model.grantAction ?? "grant"
        await as(ann, () => auditing.assertHolds([Vm.ReadWorkspace], ws))
        const asked = (e: GGAuthzDecided) => e.check === "holds" ? [e.check, e.actions, e.missing, e.scope.rn]
            : e.check === "grant" ? [e.check, e.action, e.role, e.principal, e.resource.id] : [e.check, e.action]
        expect(heard.map(e => [...asked(e), e.outcome])).toEqual([
            ["grant", grantAction, "viewer", "user:ben", "web", "allowed"],
            ["grant", grantAction, "admin", "user:ben", "web", "denied"],
            ["holds", [Vm.ReadWorkspace.name, Vm.TakeOverWorkspace.name], [Vm.TakeOverWorkspace.name], rn.ws("ann-1"), "denied"],
            ["holds", [Vm.ReadWorkspace.name], [], rn.ws("ann-1"), "allowed"],
        ])
    })

    test("a call reads each row once: its requirements, the handler's checks and row() share it; another call reads again", async () => {
        workspaceLoads.length = 0
        const requirements = GGPermissionChecker.requirementsOf({allOf: [Vm.ReadWorkspace.on("workspaceId").hide(), Vm.StopWorkspace.on("workspaceId")]})
        const row = await inCall(authority, ann, {api: "VmApi", method: "stop"}, requirements, {workspaceId: "ann-1"}, async () => {
            await authority.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-1"})
            expect(await authority.properties(Vm.types.workspace, "ann-1")).toEqual({ancestors: [rn.web, rn.org]})
            return authority.row(Vm.types.workspace, "ann-1")
        })
        expect(row).toEqual({id: "ann-1"})
        expect(workspaceLoads).toEqual(["ann-1"])
        await inCall(authority, ann, {api: "VmApi", method: "stop"}, requirements, {workspaceId: "ann-1"})
        await as(ann, () => authority.row(Vm.types.workspace, "ann-1"))
        await as(ann, () => authority.row(Vm.types.workspace, "ann-1"))
        expect(workspaceLoads).toEqual(["ann-1", "ann-1", "ann-1", "ann-1"])
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.row(Vm.types.workspace, "nope"))))).toBe(true)
        await expect(as(ann, () => authority.row(Org.types.project, "web"))).rejects.toThrow("gives no row")
        expect(await as(ann, () => authority.properties(Org.types.project, "web"))).toEqual({ancestors: [rn.org]})
        expect(await as(ann, () => authority.properties(Vm.types.workspace, "nope"))).toBeUndefined()
    })

    test("a second call in one strict request context throws: each call runs in a context of its own", async () => {
        const stop = Vm.StopWorkspace.on("workspaceId")
        await new GGContext("REQ", undefined, {strict: true}).run(async () => {
            GG_AUTHZ_SUBJECT.set(ann)
            await authority.authorize({api: "VmApi", method: "stop"}, [stop], {workspaceId: "ann-1"})
            await expect(authority.authorize({api: "VmApi", method: "stop"}, [stop], {workspaceId: "ann-1"})).rejects.toThrow("already set")
        })
    })

    test("a failed read isn't kept: the next one in the call reads again", async () => {
        let calls = 0
        const flaky = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine})
        flaky.register(Vm.types.workspace, async () => {
            if (calls++ === 0) throw new Error("throttled")
            return {properties: {ancestors: [rn.web, rn.org]}, row: {id: "ann-1"}}
        })
        await inCall(flaky, ann, {api: "VmApi", method: "status"}, [], undefined, async () => {
            await expect(flaky.row(Vm.types.workspace, "ann-1")).rejects.toThrow("throttled")
            expect(await flaky.row(Vm.types.workspace, "ann-1")).toEqual({id: "ann-1"})
            expect(await flaky.row(Vm.types.workspace, "ann-1")).toEqual({id: "ann-1"})
        })
        expect(calls).toBe(2)
    })

    test("once keeps a result for the call and subject, not a failure, and keeps nothing outside a call", async () => {
        let runs = 0
        const count = () => authority.once("k", async () => {
            if (runs++ === 0) throw new Error("throttled")
            return runs
        })
        await inCall(authority, ann, {api: "VmApi", method: "status"}, [], undefined, async () => {
            await expect(count()).rejects.toThrow("throttled")
            expect([await count(), await count()]).toEqual([2, 2])
            expect(await as({type: "user", id: "ben"}, count)).toBe(3)
        })
        expect([await count(), await count()]).toEqual([4, 5])
    })

    test("two authorities in one call read through their own loaders", async () => {
        const other = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine})
        other.register(Vm.types.workspace, () => ({properties: {ancestors: [rn.ml, rn.org]}, row: {id: "other's"}}))
        await inCall(authority, ann, {api: "VmApi", method: "status"}, [], undefined, async () => {
            expect(await authority.row(Vm.types.workspace, "ann-1")).toEqual({id: "ann-1"})
            expect(await other.row(Vm.types.workspace, "ann-1")).toEqual({id: "other's"})
        })
    })

    test("a miss isn't kept: a handler that creates the row then decides on it reads it again", async () => {
        workspaceLoads.length = 0
        await inCall(authority, ann, {api: "VmApi", method: "create"}, [], undefined, async () => {
            expect(await authority.properties(Vm.types.workspace, "new-1")).toBeUndefined()
            workspaces["new-1"] = rn.web
            try {
                await authority.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "new-1"})
            } finally {
                delete workspaces["new-1"]
            }
        })
        expect(workspaceLoads).toEqual(["new-1", "new-1"])
    })

    test("a context source names the resource", async () => {
        await as({type: "user", id: "dan"}, () => check(authority, Vm.StopWorkspace.onContext("callingWorkspace"), {}))
        expect(FORBIDDEN.is(await fail(as(ann, () => check(authority, Vm.StopWorkspace.onContext("callingWorkspace"), {}))))).toBe(true)
    })

    test("a list requirement passes; the handler filters with peek()", async () => {
        await as(ann, () => check(authority, Vm.ReadWorkspace.list(), {}))
        const refs = ["ann-1", "dan-1", "nope"].map(id => ({type: Vm.types.workspace, id}))
        expect(await as(ann, () => authority.peek(Vm.ReadWorkspace, refs))).toEqual([true, false, false])
        expect(await as(ann, () => authority.can(Vm.ReadWorkspace, {type: Vm.types.workspace, id: "cleo-1", properties: {ancestors: [rn.web, rn.org]}}))).toBe(true)
        const ws = (id: string) => ({type: Vm.types.workspace, id})
        expect(await as(ann, () => authority.peekEach([{action: Vm.ReadWorkspace, resource: ws("ann-1")}, {action: Vm.StopWorkspace, resource: ws("cleo-1")}, {action: Vm.StopWorkspace, resource: ws("nope")}])))
            .toEqual([true, false, false])
    })

    test("facts are computed per decision and reach the engine", async () => {
        factsAsked.length = 0
        const eve: GGAuthzSubject = {type: "user", id: "eve"}
        await as(eve, () => authority.assert(Git.Read, {type: Git.types.repo, id: "site"}))
        expect(FORBIDDEN.is(await fail(as(eve, () => authority.assert(Git.Read, {type: Git.types.repo, id: "models"}))))).toBe(true)
        expect(factsAsked).toEqual(["git:Read rn:acme:git:acme:repo/site", "git:Read rn:acme:git:acme:repo/models"])
    })

    test("approval stays APPROVAL_REQUIRED, also when hidden", async () => {
        const agent: GGAuthzSubject = {type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}}}
        expect(APPROVAL_REQUIRED.is(await fail(as(agent, () => check(authority, Vm.StopWorkspace.on("workspaceId").hide(), {workspaceId: "ann-1"}))))).toBe(true)
    })

    test("assertLoaders lists methods whose types need a row but have no loader", () => {
        const input = IsObject({id: IsString, repoId: IsString.orUndefined})
        const ok = new GGContractClass("OkApi", {
            stop: {input, permission: Vm.StopWorkspace.on("id")},
            manage: {input, permission: Org.ManageMembers.on(Org.types.org)},
            list: {permission: Secrets.Read.list()},
        })
        authority.assertLoaders([ok])
        const bad = new GGContractClass("BadApi", {
            read: {input, permission: Secrets.Read.on("id")},
            onType: {input, permission: Vm.StopWorkspace.on(Vm.types.workspace)},
        })
        expect(() => authority.assertLoaders([ok, bad])).toThrow("BadApi.read: no loader for secrets:secret\n  BadApi.onType: vm:workspace has no id")
    })

    test("assertHolds: FORBIDDEN naming what the caller doesn't hold on a resource", async () => {
        const ws = {type: Vm.types.workspace, id: "ann-1"}
        await as(ann, () => authority.assertHolds([Vm.ReadWorkspace, Vm.StopWorkspace], ws))
        const err = await fail(as(ann, () => authority.assertHolds([Vm.ReadWorkspace, Vm.TakeOverWorkspace], ws)))
        expect(FORBIDDEN.is(err) && err.getDebugContext()?.debugMessage).toContain(`doesn't hold ${Vm.TakeOverWorkspace.name}`)
        workspaceLoads.length = 0
        await as(ann, () => authority.assertHolds([Vm.ReadWorkspace], ws))
        expect(workspaceLoads).toEqual([])
    })

    test("no subject in context is NOT_AUTHORIZED", async () => {
        expect(NOT_AUTHORIZED.is(await fail(as(undefined, () => authority.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-1"}))))).toBe(true)
    })

    test("authorizeGrant: no escalation on a resource, throwing like assert", async () => {
        await as(ann, () => authority.authorizeGrant("viewer", "user:ben", {type: Org.types.project, id: "web"}))
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorizeGrant("admin", "user:ben", {type: Org.types.project, id: "web"}))))).toBe(true)
    })

    test("a list requirement still needs the caller's tenant", async () => {
        const tenantless = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => { throw new NOT_AUTHORIZED() }, engine: async () => engine})
        expect(NOT_AUTHORIZED.is(await fail(as(ann, () => check(tenantless, Vm.ReadWorkspace.list(), {}))))).toBe(true)
    })

    describe("approvals", () => {
        const raising = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data), approvalLevelAttribute: "approvalLevel"})
        const agent: GGAuthzSubject = {type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}}}
        const make = (approvals?: GGAuthzAuthorityConfig["approvals"]) => {
            const a = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => raising, approvals})
            a.register(Vm.types.workspace, (_t, id) => ({properties: {ancestors: [rn.web, rn.org], attributes: id === "ann-1" ? {} : {approvalLevel: "critical"}}}))
            return a
        }

        test("without `approvals`, an allow that needs one is APPROVAL_REQUIRED with its level", async () => {
            const e = await fail(as(agent, () => check(make(), Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"})))
            expect(APPROVAL_REQUIRED.is(e) && e.data).toEqual({action: Vm.StopWorkspace.name, resource: "rn:acme:vm:acme:workspace/ann-1", level: "ask-once", key: undefined})
        })

        test("`approvals` decides; a resource attribute raises the level; a registered key names what it's for", async () => {
            const needs: GGAuthzApprovalNeed[] = []
            const authority = make(async need => { needs.push(need) })
            authority.registerApprovalKey(Vm.StopWorkspace, input => ({type: Org.types.project, id: String(input.why)}))
            await as(agent, () => check(authority, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1", why: "web"}))
            await as(agent, () => authority.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-2"}))
            expect(needs.map(n => [n.action, n.resource.rn, n.key.rn, n.level])).toEqual([
                [Vm.StopWorkspace.name, "rn:acme:vm:acme:workspace/ann-1", "rn:acme:org:acme:project/web", "ask-once"],
                [Vm.StopWorkspace.name, "rn:acme:vm:acme:workspace/ann-2", "rn:acme:vm:acme:workspace/ann-2", "critical"],
            ])
        })

        test("can/peek: an allow that needs an approval is not allowed, and asks nobody", async () => {
            const needs: GGAuthzApprovalNeed[] = []
            const authority = make(async need => { needs.push(need) })
            const ref = {type: Vm.types.workspace, id: "ann-1"}
            expect(await as(ann, () => authority.can(Vm.StopWorkspace, ref))).toBe(true)
            expect(await as(agent, () => authority.can(Vm.StopWorkspace, ref))).toBe(false)
            expect(await as(agent, () => authority.peek(Vm.StopWorkspace, [ref]))).toEqual([false])
            expect(needs).toEqual([])
        })

        test("decided hears the approval's answer: approved, or unapproved with the error", async () => {
            const heard: GGAuthzDecided[] = []
            const decided = (e: GGAuthzDecided) => { heard.push(e) }
            const approving = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => raising, decided, approvals: async () => undefined})
            const asking = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => raising, decided})
            for (const a of [approving, asking]) a.register(Vm.types.workspace, () => ({properties: {ancestors: [rn.web, rn.org]}}))
            await as(agent, () => check(approving, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"}))
            const err = await fail(as(agent, () => check(asking, Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"})))
            expect(APPROVAL_REQUIRED.is(err)).toBe(true)
            expect(heard.map(e => [e.outcome, e.outcome === "approved" || e.outcome === "unapproved" ? e.level : undefined, e.outcome === "unapproved" && e.error === err])).toEqual([
                ["approved", "ask-once", false],
                ["unapproved", "ask-once", true],
            ])
        })

        test("a grant that needs approval goes to `approvals`, which is told the role and principal", async () => {
            const needs: GGAuthzApprovalNeed[] = []
            // The org's ask-once on vm:* makes the agent's grant action on a workspace need approval.
            const gated = new GGAuthz({
                model: {...model, grantAction: Vm.StopWorkspace.name},
                policies: {...policies, roles: [{name: "watcher", actions: [Vm.ReadWorkspace.name]}]},
                resolver: new GGAuthzMemoryResolver(data),
            })
            const a = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => gated, approvals: async need => { needs.push(need) }})
            a.register(Vm.types.workspace, (_t, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
            await as(agent, () => a.authorizeGrant("watcher", "user:ben", {type: Vm.types.workspace, id: "ann-1"}))
            expect(needs.map(n => [n.action, n.resource.rn, n.level, n.grant])).toEqual([[Vm.StopWorkspace.name, rn.ws("ann-1"), "ask-once", {role: "watcher", principal: "user:ben"}]])
        })
    })

    test("undeclared: a handler deciding an action its call's requirements don't declare is reported, also with no requirements; a filter isn't", async () => {
        const reported: string[] = []
        const guarded = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            undeclared: (call, action) => reported.push(`${call.api}.${call.method} ${action}`),
        })
        guarded.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        const ws = {type: Vm.types.workspace, id: "ann-1"}
        const stop = Vm.StopWorkspace.on("workspaceId")
        await inCall(guarded, ann, {api: "VmApi", method: "stop"}, [stop], {workspaceId: "ann-1"}, async () => {
            await guarded.assert(Vm.StopWorkspace, ws)
            await guarded.can(Vm.StartWorkspace, ws)
            await guarded.peek(Vm.ReadWorkspace, [ws])
        })
        await inCall(guarded, ann, {api: "VmApi", method: "status"}, [], undefined, () => guarded.can(Vm.ReadWorkspace, ws))
        // Outside a contract call there is nothing to compare with.
        await as(ann, () => guarded.can(Vm.StartWorkspace, ws))
        expect(reported).toEqual([`VmApi.stop ${Vm.StartWorkspace.name}`, `VmApi.status ${Vm.ReadWorkspace.name}`])
    })

    test("assertMayApprove decides as can, isn't undeclared, is heard as an approve check, and declares what it allowed", async () => {
        const reported: string[] = []
        const heard: GGAuthzDecided[] = []
        const approving = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            undeclared: (call, action) => reported.push(`${call.api}.${call.method} ${action}`),
            decided: e => { heard.push(e) },
        })
        approving.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        await inCall(approving, ann, {api: "ApprovalsApi", method: "resolve"}, [], undefined, async () => {
            await approving.assertMayApprove(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-1"})
            await approving.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-1"})
            const err = await fail(approving.assertMayApprove(Vm.StopWorkspace, {type: Vm.types.workspace, id: "dan-1"}, {displayMessage: "not yours to approve"}))
            expect(FORBIDDEN.is(err) && err.context?.displayMessage).toBe("not yours to approve")
        })
        expect(reported).toEqual([])
        expect(heard.map(e => [e.check, e.outcome])).toEqual([["approve", "allowed"], ["action", "allowed"], ["approve", "denied"]])
    })
})
