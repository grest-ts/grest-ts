import {FORBIDDEN, GGContractClass, IsObject, IsString, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {APPROVAL_REQUIRED, defineAuthzService, GG_AUTHZ_ERRORS, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED} from "../src/index-node"
import {Git, Org, Secrets, Vm} from "./world"

describe("requirement builders", () => {
    test(".on(field) reads an input field of the action's one type", () => {
        const r = Vm.StopWorkspace.on("workspaceId")
        expect(r).toEqual({__permission: "requirement", action: "vm:StopWorkspace", resource: {type: "vm:workspace", id: {field: "workspaceId"}}, errors: GG_AUTHZ_ERRORS})
        expect(Object.isFrozen(r) && Object.isFrozen(r.resource) && Object.isFrozen(r.resource!.id)).toBe(true)
        expect(Object.keys(r)).not.toContain("hide")
    })

    test("an action on several types names the type, which must be one of them", () => {
        expect(Org.ManageMembers.on("org:project", "projectId").resource).toEqual({type: "org:project", id: {field: "projectId"}})
        // @ts-expect-error several types: name one
        expect(() => Org.ManageMembers.on("projectId")).toThrow("name the type")
        // @ts-expect-error not one of the action's types
        expect(() => Org.ManageMembers.on("vm:workspace", "id")).toThrow("doesn't apply to vm:workspace")
    })

    test(".on(type) is the tenant itself; .onContext names a request-implied id", () => {
        expect(Org.ManageMembers.on(Org.types.org).resource).toEqual({type: "org:org"})
        expect(Vm.StopWorkspace.onContext("callingWorkspace").resource).toEqual({type: "vm:workspace", id: {context: "callingWorkspace"}})
        expect(Org.ManageMembers.onContext(Org.types.project, "p").resource).toEqual({type: "org:project", id: {context: "p"}})
    })

    test(".hide(), .orCreateOn() and .list() return new frozen requirements", () => {
        const base = Org.ManageMembers.on(Org.types.project, "projectId")
        const hidden = base.hide()
        expect(hidden.hidden).toBe(true)
        expect(base.hidden).toBeUndefined()
        const upsert = base.orCreateOn(Org.types.org, "orgId").hide()
        expect(upsert).toMatchObject({resource: {type: "org:project", id: {field: "projectId"}}, createOn: {type: "org:org", id: {field: "orgId"}}, hidden: true})
        expect(Vm.ReadWorkspace.list()).toEqual({__permission: "requirement", action: "vm:ReadWorkspace", list: true, errors: GG_AUTHZ_ERRORS})
        expect(() => Org.ManageMembers.on(Org.types.org).orCreateOn(Org.types.project, "projectId")).toThrow("input field")
        // @ts-expect-error not one of the action's types
        expect(() => Secrets.Write.on("secretId").orCreateOn(Git.types.repo, "repoId")).toThrow("doesn't apply to git:repo")
    })

    test("a contract checks the field and merges the authz errors", () => {
        const Contract = new GGContractClass("RequirementContract", {
            stop: {input: IsObject({workspaceId: IsString}), errors: [SERVER_ERROR], permission: Vm.StopWorkspace.on("workspaceId").hide()},
            save: {input: IsObject({projectId: IsString.orUndefined, orgId: IsString}), errors: [SERVER_ERROR], permission: Org.ManageMembers.on(Org.types.project, "projectId").orCreateOn(Org.types.org, "orgId")},
        })
        expect(Contract.methods.stop.errors).toEqual([SERVER_ERROR, NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, APPROVAL_REQUIRED, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED])
        expect(() => new GGContractClass("BadField", {
            // @ts-expect-error the input has no workspaceId
            stop: {input: IsObject({id: IsString}), errors: [SERVER_ERROR], permission: Vm.StopWorkspace.on("workspaceId")},
        })).toThrow("input.workspaceId")
    })

    test("service definitions stay strict about action types", () => {
        // @ts-expect-error a typo in `on`
        expect(() => defineAuthzService("typos", {types: {thing: ""}, actions: {Use: {on: ["thingg"]}}})).toThrow("unknown type thingg")
    })
})
