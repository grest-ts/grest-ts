import type {GGAuthorityHandler} from "@grest-ts/http"
import {GGContractClass, GGPermissionChecker, IsObject, IsString} from "@grest-ts/schema"
import {FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {APPROVAL_REQUIRED, GGAuthz, GGAuthzAuthority, GGAuthzMemoryResolver, type GGAuthzApprovalNeed, type GGAuthzAuthorityConfig, type GGAuthzSubject} from "../src/index-node"
import {as} from "./util"
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

// GGAuthzAuthority matches @grest-ts/http's handler by shape (src may not depend on http); this keeps the two in step.
void (authority satisfies GGAuthorityHandler)

describe("GGAuthzAuthority", () => {
    test("reads the id from the input, loads the row and decides", async () => {
        await as(ann, () => authority.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"}))
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "cleo-1"}))))).toBe(true)
    })

    test("a field may be a path into the input", async () => {
        await as(ann, () => authority.authorize(Vm.StopWorkspace.on("target.workspaceId"), {target: {workspaceId: "ann-1"}}))
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorize(Vm.StopWorkspace.on("target.workspaceId"), {target: {workspaceId: "cleo-1"}}))))).toBe(true)
        const save = Org.ManageMembers.on(Org.types.project, "at.projectId").orCreateOn(Org.types.org)
        expect((await fail(as(ann, () => authority.authorize(save, {at: {}})))).getDebugContext().debugMessage).toContain("on rn:acme:org:acme:org/acme")
    })

    test("a missing row is NOT_FOUND, and so is a hidden denial", async () => {
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "nope"}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "bad/id"}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.authorize(Vm.StopWorkspace.on("workspaceId").hide(), {workspaceId: "cleo-1"}))))).toBe(true)
    })

    test("the tenant type without an id is the caller's tenant; another tenant's id is NOT_FOUND", async () => {
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorize(Org.ManageMembers.on(Org.types.org), {}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.authorize(Org.ManageMembers.on(Org.types.org, "orgId"), {orgId: "other"}))))).toBe(true)
        await expect(as(ann, () => authority.authorize(Vm.StopWorkspace.on(Vm.types.workspace), {}))).rejects.toThrow("only org:org")
    })

    test("an upsert checks the existing resource, or the parent when creating", async () => {
        const save = Org.ManageMembers.on(Org.types.project, "projectId").orCreateOn(Org.types.org, "orgId")
        const creating = await fail(as(ann, () => authority.authorize(save, {orgId: "acme"})))
        expect(creating.getDebugContext().debugMessage).toContain("on rn:acme:org:acme:org/acme")
        const updating = await fail(as(ann, () => authority.authorize(save, {projectId: "web", orgId: "acme"})))
        expect(updating.getDebugContext().debugMessage).toContain("on rn:acme:org:acme:project/web")
        await as({type: "user", id: "cleo"}, () => authority.authorize(save, {projectId: "web", orgId: "acme"}))
        const onTenant = Org.ManageMembers.on(Org.types.project, "projectId").orCreateOn(Org.types.org)
        expect((await fail(as(ann, () => authority.authorize(onTenant, {})))).getDebugContext().debugMessage).toContain("on rn:acme:org:acme:org/acme")
        await expect(as(ann, () => authority.assert(Secrets.Read, {type: Secrets.types.secret, id: "x"}))).rejects.toThrow("No loader registered for secrets:secret")
    })

    test("the config's hidden makes a denial on that resource NOT_FOUND, also when asking what an approval needs", async () => {
        const hiding = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine, hidden: r => r.id === "cleo-1"})
        hiding.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        expect(NOT_FOUND.is(await fail(as(ann, () => hiding.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "cleo-1"}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => hiding.approvalNeed(Vm.StopWorkspace, {type: Vm.types.workspace, id: "cleo-1"}))))).toBe(true)
        expect(FORBIDDEN.is(await fail(as(ann, () => hiding.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "dan-1"}))))).toBe(true)
    })

    test("hidden is asked about the denied action, so a denial can stay FORBIDDEN for some actions only", async () => {
        const exempt = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine, hidden: (r, action) => r.id === "cleo-1" && action !== Vm.StopWorkspace.name})
        exempt.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        expect(FORBIDDEN.is(await fail(as(ann, () => exempt.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "cleo-1"}))))).toBe(true)
    })

    test("explainForbidden replaces an unhidden denial on assert only: hidden stays NOT_FOUND, can/allowed never ask", async () => {
        const asked: string[] = []
        let fails = false
        const explaining = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            hidden: r => r.id === "cleo-1",
            explainForbidden: async (action, r) => {
                asked.push(`${action} ${r.id}`)
                if (fails) throw new Error("GitHub down")
                return new FORBIDDEN({displayMessage: `why ${r.id}`})
            },
        })
        explaining.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        const err = await fail(as(ann, () => explaining.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "dan-1"})))
        expect(FORBIDDEN.is(err) && err.context?.displayMessage).toBe("why dan-1")
        expect(NOT_FOUND.is(await fail(as(ann, () => explaining.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "cleo-1"}))))).toBe(true)
        expect(await as(ann, () => explaining.can(Vm.StopWorkspace, {type: Vm.types.workspace, id: "dan-1"}))).toBe(false)
        expect(asked).toEqual([`${Vm.StopWorkspace.name} dan-1`])
        fails = true
        expect(FORBIDDEN.is(await fail(as(ann, () => explaining.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "dan-1"}))))).toBe(true)
    })

    test("a row is loaded once per request: every requirement part and the handler's row() share it", async () => {
        workspaceLoads.length = 0
        // A wire sets a new subject per request.
        const row = await as({...ann}, async () => {
            for (const r of GGPermissionChecker.requirementsOf({allOf: [Vm.ReadWorkspace.on("workspaceId").hide(), Vm.StopWorkspace.on("workspaceId")]})) {
                await authority.authorize(r, {workspaceId: "ann-1"})
            }
            return authority.row(Vm.types.workspace, "ann-1")
        })
        expect(row).toEqual({id: "ann-1"})
        expect(workspaceLoads).toEqual(["ann-1"])
        await as({...ann}, () => authority.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"}))
        expect(workspaceLoads).toEqual(["ann-1", "ann-1"])
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.row(Vm.types.workspace, "nope"))))).toBe(true)
        await expect(as(ann, () => authority.row(Org.types.project, "web"))).rejects.toThrow("gives no row")
    })

    test("a failed load isn't kept: the next ask in the request reads again", async () => {
        let calls = 0
        const flaky = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine})
        flaky.register(Vm.types.workspace, async () => {
            if (calls++ === 0) throw new Error("throttled")
            return {properties: {ancestors: [rn.web, rn.org]}, row: {id: "ann-1"}}
        })
        await as({...ann}, async () => {
            await expect(flaky.row(Vm.types.workspace, "ann-1")).rejects.toThrow("throttled")
            expect(await flaky.row(Vm.types.workspace, "ann-1")).toEqual({id: "ann-1"})
        })
    })

    test("a context source names the resource", async () => {
        await as({type: "user", id: "dan"}, () => authority.authorize(Vm.StopWorkspace.onContext("callingWorkspace"), {}))
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorize(Vm.StopWorkspace.onContext("callingWorkspace"), {}))))).toBe(true)
    })

    test("a list requirement passes; the handler filters with allowed()", async () => {
        await as(ann, () => authority.authorize(Vm.ReadWorkspace.list(), {}))
        const refs = ["ann-1", "dan-1", "nope"].map(id => ({type: Vm.types.workspace, id}))
        expect(await as(ann, () => authority.allowed(Vm.ReadWorkspace, refs))).toEqual([true, false, false])
        expect(await as(ann, () => authority.can(Vm.ReadWorkspace, {type: Vm.types.workspace, id: "cleo-1", properties: {ancestors: [rn.web, rn.org]}}))).toBe(true)
        const ws = (id: string) => ({type: Vm.types.workspace, id})
        expect(await as(ann, () => authority.allowedEach([{action: Vm.ReadWorkspace, resource: ws("ann-1")}, {action: Vm.StopWorkspace, resource: ws("cleo-1")}, {action: Vm.StopWorkspace, resource: ws("nope")}])))
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
        expect(APPROVAL_REQUIRED.is(await fail(as(agent, () => authority.authorize(Vm.StopWorkspace.on("workspaceId").hide(), {workspaceId: "ann-1"}))))).toBe(true)
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

    test("missingActions: what the caller doesn't hold on a resource", async () => {
        expect(await as(ann, () => authority.missingActions([Vm.ReadWorkspace, Vm.StopWorkspace, Vm.TakeOverWorkspace], {type: Vm.types.workspace, id: "ann-1"}))).toEqual([Vm.TakeOverWorkspace.name])
    })

    test("authorizeGrant: no escalation on a resource, throwing like assert", async () => {
        await as(ann, () => authority.authorizeGrant("viewer", "user:ben", {type: Org.types.project, id: "web"}))
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorizeGrant("admin", "user:ben", {type: Org.types.project, id: "web"}))))).toBe(true)
    })

    test("a list requirement still needs the caller's tenant", async () => {
        const tenantless = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => { throw new NOT_AUTHORIZED() }, engine: async () => engine})
        expect(NOT_AUTHORIZED.is(await fail(as(ann, () => tenantless.authorize(Vm.ReadWorkspace.list(), {}))))).toBe(true)
    })

    describe("approvals", () => {
        const agent: GGAuthzSubject = {type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}}}
        const make = (approvals?: GGAuthzAuthorityConfig["approvals"]) => {
            const a = new GGAuthzAuthority({partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine, approvals, approvalLevelAttribute: "approvalLevel"})
            a.register(Vm.types.workspace, (_t, id) => ({properties: {ancestors: [rn.web, rn.org], attributes: id === "ann-1" ? {} : {approvalLevel: "critical"}}}))
            return a
        }

        test("without `approvals`, an allow that needs one is APPROVAL_REQUIRED with its level", async () => {
            const e = await fail(as(agent, () => make().authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"})))
            expect(APPROVAL_REQUIRED.is(e) && e.data).toEqual({action: Vm.StopWorkspace.name, resource: "rn:acme:vm:acme:workspace/ann-1", level: "ask-once", key: undefined})
        })

        test("`approvals` decides; a resource attribute raises the level; a registered key names what it's for", async () => {
            const needs: GGAuthzApprovalNeed[] = []
            const authority = make(async need => { needs.push(need) })
            authority.registerApprovalKey(Vm.StopWorkspace, input => ({type: Org.types.project, id: String(input.why)}))
            await as(agent, () => authority.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1", why: "web"}))
            await as(agent, () => authority.assert(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-2"}))
            expect(needs.map(n => [n.action, n.resource.rn, n.key.rn, n.level])).toEqual([
                [Vm.StopWorkspace.name, "rn:acme:vm:acme:workspace/ann-1", "rn:acme:org:acme:project/web", "ask-once"],
                [Vm.StopWorkspace.name, "rn:acme:vm:acme:workspace/ann-2", "rn:acme:vm:acme:workspace/ann-2", "critical"],
            ])
        })

        test("can/allowed: an allow that needs an approval is not allowed, and asks nobody", async () => {
            const needs: GGAuthzApprovalNeed[] = []
            const authority = make(async need => { needs.push(need) })
            const ref = {type: Vm.types.workspace, id: "ann-1"}
            expect(await as(ann, () => authority.can(Vm.StopWorkspace, ref))).toBe(true)
            expect(await as(agent, () => authority.can(Vm.StopWorkspace, ref))).toBe(false)
            expect(await as(agent, () => authority.allowed(Vm.StopWorkspace, [ref]))).toEqual([false])
            expect(needs).toEqual([])
        })

        test("approvalNeed: undefined when allowed outright, the need otherwise", async () => {
            const authority = make()
            expect(await as(ann, () => authority.approvalNeed(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-1"}))).toBeUndefined()
            expect(await as(agent, () => authority.approvalNeed(Vm.StopWorkspace, {type: Vm.types.workspace, id: "ann-1"}))).toMatchObject({level: "ask-once", key: {rn: "rn:acme:vm:acme:workspace/ann-1"}})
        })
    })

    test("undeclared: a handler deciding an action its method's requirements don't name is reported; a filter isn't", async () => {
        const reported: string[] = []
        const guarded = new GGAuthzAuthority({
            partition: "acme", tenantType: Org.types.org, tenant: () => "acme", engine: async () => engine,
            undeclared: (call, action) => reported.push(`${call.api}.${call.method} ${action}`),
        })
        guarded.register(Vm.types.workspace, (_tenant, id) => workspaces[id] ? {properties: {ancestors: [workspaces[id]!, rn.org]}} : undefined)
        const ws = {type: Vm.types.workspace, id: "ann-1"}
        await as(ann, async () => {
            await guarded.authorize(Vm.StopWorkspace.on("workspaceId"), {workspaceId: "ann-1"}, {api: "VmApi", method: "stop"})
            await guarded.assert(Vm.StopWorkspace, ws)
            await guarded.can(Vm.StartWorkspace, ws)
            await guarded.assert(Vm.ReadWorkspace, ws)
            await guarded.allowed(Vm.ReadWorkspace, [ws])
        })
        // Another request (the wire sets a subject per request) that ran no requirements has nothing to compare with.
        await as({...ann}, () => guarded.can(Vm.StartWorkspace, ws))
        expect(reported).toEqual([`VmApi.stop ${Vm.StartWorkspace.name}`, `VmApi.stop ${Vm.ReadWorkspace.name}`])
    })
})
