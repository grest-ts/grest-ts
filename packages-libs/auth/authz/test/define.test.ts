import {GGContractClass, IsObject, IsString, NOT_FOUND} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {APPROVAL_REQUIRED, defineAuthzModel, defineAuthzRole, defineAuthzService, describeAuthzModel, documentAuthzModel} from "../src/index-node"
import {Cloud, model, Org, Secrets, Vm} from "./world"

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
        expect(() => defineAuthzModel({partition: "acme", tenantType: "org:org", services: [Vm, Org], roles: [defineAuthzRole("needs-cloud", {actions: [Cloud.Launch]})]})).toThrow("Unknown action cloud:Launch")
        expect(() => defineAuthzModel({partition: "acme", tenantType: "org:org", services: [Vm, Vm, Org], roles: []})).toThrow("Duplicate action")
    })

    test("a name defined in two places throws; re-evaluating the same definition does not", () => {
        for (let i = 0; i < 2; i++) defineAuthzService("loop", {types: {thing: ""}, actions: {Use: {on: ["thing"]}}})
        defineAuthzService("twice", {types: {thing: ""}, actions: {}})
        expect(() => defineAuthzService("twice", {types: {thing: ""}, actions: {}})).toThrow("Duplicate authz service twice")
        expect(() => defineAuthzService("vm", {types: {thing: ""}, actions: {}})).toThrow(/Duplicate authz service vm: defined at .*world\.ts.* and .*define\.test\.ts/)
        defineAuthzRole("twice", {actions: []})
        expect(() => defineAuthzRole("twice", {actions: []})).toThrow("Duplicate authz role twice")
    })

    test("an approval floor without workload types fails at load", () => {
        const Floor = defineAuthzService("floor", {types: {thing: ""}, actions: {Use: {on: ["thing"]}}})
        expect(() => defineAuthzModel({partition: "p", tenantType: Floor.types.thing, services: [Floor], roles: [], approvalFloor: [{actions: [Floor.Use], level: "ask"}]})).toThrow("workloadTypes")
    })

    test("bad names fail at definition", () => {
        expect(() => defineAuthzService("bad", {types: {thing: ""}, actions: {use: {on: ["thing"]}}})).toThrow("upper-case")
        expect(() => defineAuthzService("bad2", {types: {thing: ""}, actions: {Use: {on: ["other" as "thing"]}}})).toThrow("unknown type other")
        expect(() => defineAuthzService("Bad3", {types: {thing: ""}, actions: {}})).toThrow()
    })

    test("an action may be on another service's type, which the model must declare", () => {
        const Folders = defineAuthzService("folders", {types: {folder: ""}, actions: {Read: {on: ["folder"]}}})
        const Files = defineAuthzService("files", {types: {file: ""}, actions: {Create: {on: ["folders:folder"]}, Read: {on: ["file"]}}})
        expect(Files.Create.resourceTypes).toEqual(["folders:folder"])
        expect(defineAuthzModel({partition: "p", tenantType: Folders.types.folder, services: [Folders, Files], roles: []}).actions.map(a => a.name)).toContain("files:Create")
        expect(() => defineAuthzModel({partition: "p", tenantType: Files.types.file, services: [Files], roles: []})).toThrow("files:Create is on folders:folder, which no service in the model declares")
    })

    test("the type tree: every parent is declared, and the tenant type is declared and in nothing", () => {
        const Pages = defineAuthzService("pages", {types: {page: {description: "", in: ["books:book"]}}, actions: {}})
        expect(() => defineAuthzModel({partition: "p", tenantType: "org:org", services: [Pages, Org], roles: []})).toThrow("Type pages:page is in books:book, which no service in the model declares")
        expect(() => defineAuthzModel({partition: "p", tenantType: "books:book", services: [Org], roles: []})).toThrow("The tenant type books:book is not declared")
        expect(() => defineAuthzModel({partition: "p", tenantType: Vm.types.workspace, services: [Vm, Org], roles: []})).toThrow("The tenant type vm:workspace can't be in another type")
        expect(model).toMatchObject({tenantType: "org:org", types: expect.arrayContaining([{name: "vm:workspace", parents: ["org:project"]}, {name: "org:org", parents: undefined}])})
    })

    test("`parents` place a type in the tree without its actions applying there; `in` does both", () => {
        const Shelf = defineAuthzService("shelf", {types: {box: {description: "", in: ["shelf"], parents: [Org.types.project]}, shelf: ""}, actions: {Open: {on: ["box"]}}})
        expect(Shelf.Open.resourceTypes).toEqual(["shelf:box", "shelf:shelf"])
        const defined = defineAuthzModel({partition: "p", tenantType: Org.types.org, services: [Shelf, Org], roles: []})
        expect(defined.types.find(t => t.name === Shelf.types.box)?.parents).toEqual(["shelf:shelf", "org:project"])
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
        const catalog = describeAuthzModel(model, {contracts: [WorkspaceApi]})
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
        const Nope = defineAuthzService("nope", {types: {thing: "Not in the model"}, actions: {Do: {on: ["thing"]}}})
        const Other = new GGContractClass("OtherApi", {x: {permission: Nope.Do.on(Nope.types.thing)}})
        expect(() => describeAuthzModel(model, {contracts: [Other]})).toThrow("OtherApi.x declares unknown action nope:Do")
    })

    test("document renders the catalog as markdown", () => {
        const md = documentAuthzModel(model, {contracts: [WorkspaceApi]})
        expect(md).toContain("| `vm:StopWorkspace` | `vm:workspace` |  | member, owner, admin | workspaces:operate |  | `WorkspaceApi.stop` |")
        expect(md).toContain(`| \`${Secrets.Write.name}\` | \`secrets:secret\` |  | owner, admin |  | ask |  |`)
        expect(md).toContain("| viewer | Read-only | `vm:ReadWorkspace`, `git:Read` |")
    })
})
