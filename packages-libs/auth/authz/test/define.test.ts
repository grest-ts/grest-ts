import {GGContractClass, IsObject, IsString, NOT_FOUND} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {APPROVAL_REQUIRED, GGAuthzRole, GGAuthzService, GGAuthzModel} from "../src/index-node"
import {Cloud, model, Secrets, Vm} from "./world"

describe("define functions", () => {
    test("a service gives typed, frozen actions and types", () => {
        expect(Vm.StopWorkspace).toEqual({name: "vm:StopWorkspace", resourceTypes: ["vm:workspace"], description: undefined})
        expect(Vm.types.workspace).toBe("vm:workspace")
        expect(Vm.all).toBe("vm:*")
        expect(Object.isFrozen(Vm)).toBe(true)
        expect(Object.isFrozen(Vm.StopWorkspace.resourceTypes)).toBe(true)
        expect(Vm.definedAt).toContain("world.ts")
    })

    test("the model is validated and deep-frozen", () => {
        expect(Object.isFrozen(model.roles[0]!.actions)).toBe(true)
        expect(() => GGAuthzModel.define({partition: "acme", services: [Vm], roles: [GGAuthzRole.define("needs-cloud", {actions: [Cloud.Launch]})]})).toThrow("Unknown action cloud:Launch")
        expect(() => GGAuthzModel.define({partition: "acme", services: [Vm, Vm], roles: []})).toThrow("Duplicate action")
    })

    test("a name defined in two places throws; re-evaluating the same definition does not", () => {
        for (let i = 0; i < 2; i++) GGAuthzService.define("loop", {types: {thing: ""}, actions: {Use: {on: ["thing"]}}})
        GGAuthzService.define("twice", {types: {thing: ""}, actions: {}})
        expect(() => GGAuthzService.define("twice", {types: {thing: ""}, actions: {}})).toThrow("Duplicate authz service twice")
        expect(() => GGAuthzService.define("vm", {types: {thing: ""}, actions: {}})).toThrow(/Duplicate authz service vm: defined at .*world\.ts.* and .*define\.test\.ts/)
        GGAuthzRole.define("twice", {actions: []})
        expect(() => GGAuthzRole.define("twice", {actions: []})).toThrow("Duplicate authz role twice")
    })

    test("an approval floor without workload types fails at load", () => {
        const Floor = GGAuthzService.define("floor", {types: {thing: ""}, actions: {Use: {on: ["thing"]}}})
        expect(() => GGAuthzModel.define({partition: "p", services: [Floor], roles: [], approvalFloor: [{actions: [Floor.Use], level: "ask"}]})).toThrow("workloadTypes")
    })

    test("bad names fail at definition", () => {
        expect(() => GGAuthzService.define("bad", {types: {thing: ""}, actions: {use: {on: ["thing"]}}})).toThrow("upper-case")
        expect(() => GGAuthzService.define("bad2", {types: {thing: ""}, actions: {Use: {on: ["other" as "thing"]}}})).toThrow("unknown type other")
        expect(() => GGAuthzService.define("Bad3", {types: {thing: ""}, actions: {}})).toThrow()
    })

    test("an action may be on another service's type, which the model must declare", () => {
        const Folders = GGAuthzService.define("folders", {types: {folder: ""}, actions: {Read: {on: ["folder"]}}})
        const Files = GGAuthzService.define("files", {types: {file: ""}, actions: {Create: {on: ["folders:folder"]}, Read: {on: ["file"]}}})
        expect(Files.Create.resourceTypes).toEqual(["folders:folder"])
        expect(GGAuthzModel.define({partition: "p", services: [Folders, Files], roles: []}).actions.map(a => a.name)).toContain("files:Create")
        expect(() => GGAuthzModel.define({partition: "p", services: [Files], roles: []})).toThrow("files:Create is on folders:folder, which no service in the model declares")
    })
})

describe("contract methods", () => {
    const WorkspaceApi = new GGContractClass("WorkspaceApi", {
        stop: {input: IsObject({workspaceId: IsString}), errors: [NOT_FOUND], permission: Vm.StopWorkspace.on("workspaceId")},
        list: {},
    })

    test("a requirement adds the authz errors to the method", () => {
        expect(WorkspaceApi.methods.stop.errors.map(e => e.TYPE)).toEqual(["NOT_FOUND", "NOT_AUTHORIZED", "FORBIDDEN", APPROVAL_REQUIRED.TYPE, "INSUFFICIENT_SCOPE", "STEP_UP_REQUIRED"])
    })

    test("describe lists roles, scopes, floors and declaring methods per action", () => {
        const catalog = GGAuthzModel.describe(model, {contracts: [WorkspaceApi]})
        expect(catalog.actions.find(a => a.name === "vm:StopWorkspace")).toMatchObject({
            roles: ["member", "owner", "admin"],
            tokenScopes: ["workspaces:operate"],
            methods: ["WorkspaceApi.stop"],
        })
        expect(catalog.actions.find(a => a.name === "secrets:Write")).toMatchObject({roles: ["owner", "admin"], approvalFloor: "ask", methods: []})
        expect(catalog.actions.find(a => a.name === Vm.TakeOverWorkspace.name)!.definedAt).toContain("world.ts")
        expect(catalog.roles.find(r => r.name === "viewer")).toMatchObject({description: "Read-only", actions: ["vm:ReadWorkspace", "git:Read"]})
    })

    test("describe rejects a contract that declares an unknown action", () => {
        const Nope = GGAuthzService.define("nope", {types: {thing: "Not in the model"}, actions: {Do: {on: ["thing"]}}})
        const Other = new GGContractClass("OtherApi", {x: {permission: Nope.Do.on(Nope.types.thing)}})
        expect(() => GGAuthzModel.describe(model, {contracts: [Other]})).toThrow("OtherApi.x declares unknown action nope:Do")
    })

    test("document renders the catalog as markdown", () => {
        const md = GGAuthzModel.document(model, {contracts: [WorkspaceApi]})
        expect(md).toContain("| `vm:StopWorkspace` | `vm:workspace` |  | member, owner, admin | workspaces:operate |  | `WorkspaceApi.stop` |")
        expect(md).toContain(`| \`${Secrets.Write.name}\` | \`secrets:secret\` |  | owner, admin |  | ask |  |`)
        expect(md).toContain("| viewer | Read-only | `vm:ReadWorkspace`, `git:Read` |")
    })
})
