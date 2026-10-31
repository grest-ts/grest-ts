import {FORBIDDEN, GGContractClass, IsObject, IsString, NOT_FOUND, SERVER_ERROR} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {defineAuthzModel, defineAuthzRole, defineAuthzService, GG_AUTHZ_ERRORS, GGAuthz, GGAuthzAuthority, GGAuthzMemoryResolver, type GGAuthzSubject} from "../src/index-node"
import {as} from "./util"

const Places = defineAuthzService("places", {
    types: {org: "The tenant", project: "A project", member: "A member's own space"},
    actions: {ReadProject: {on: ["project"]}},
})
const Clouds = defineAuthzService("clouds", {
    types: {
        cloud: {description: "A cloud account", in: [Places.types.org, Places.types.project, Places.types.member]},
        image: "An image built on a cloud",
    },
    actions: {
        Read: {on: ["cloud", "image"]},
        Write: {on: ["cloud"]},
    },
})

const rn = {
    org: "rn:acme:places:acme:org/acme",
    project: (id: string) => `rn:acme:places:acme:project/${id}`,
    member: (id: string) => `rn:acme:places:acme:member/${id}`,
}

describe("types with parents", () => {
    test("every action on the type also applies to its parents", () => {
        expect(Clouds.Write.resourceTypes).toEqual(["clouds:cloud", "places:org", "places:project", "places:member"])
        expect(Clouds.Read.resourceTypes).toEqual(["clouds:cloud", "clouds:image", "places:org", "places:project", "places:member"])
        expect(Clouds.resourceTypes[0]).toEqual({name: "clouds:cloud", description: "A cloud account", in: ["places:org", "places:project", "places:member"]})
        expect(() => defineAuthzService("typos-in", {types: {thing: {description: "", in: ["nowhere"]}}, actions: {}})).toThrow("Type typos-in:thing is on unknown type nowhere")
    })

    test("parentRef is the input schema of a parent", () => {
        const IsParent = Clouds.parentRef("cloud")
        const ok: {type: "places:org" | "places:project" | "places:member", id: string} = IsParent.parse({type: "places:project", id: "web"})
        expect(ok).toEqual({type: "places:project", id: "web"})
        expect(() => IsParent.parse({type: "clouds:image", id: "x"})).toThrow()
        // @ts-expect-error an image has no parents
        expect(() => Clouds.parentRef("image")).toThrow("has no `in`")
    })

    test(".in(field) decides inside the parent; .on(field) still means the item", () => {
        expect(Clouds.Write.in("parent")).toEqual({
            __permission: "requirement", action: "clouds:Write",
            resource: {type: "clouds:cloud", in: {field: "parent", types: ["places:org", "places:project", "places:member"]}},
            errors: GG_AUTHZ_ERRORS,
        })
        expect(Clouds.Read.in("parent").resource).toEqual(Clouds.Write.in("parent").resource)
        expect(Clouds.Write.on("cloudId").resource).toEqual({type: "clouds:cloud", id: {field: "cloudId"}})
        expect(Clouds.Write.on(Places.types.org).resource).toEqual({type: "places:org"})
        expect(Clouds.Write.on(Places.types.project, "projectId").resource).toEqual({type: "places:project", id: {field: "projectId"}})
        // @ts-expect-error an image has no parents, and Write isn't on it
        expect(() => Clouds.Write.in(Clouds.types.image, "parent")).toThrow("has no `in`")
        expect(() => Places.ReadProject.in("parent")).toThrow("none of its types has `in`: name the type")
    })

    test("a contract checks the parent field against the type's parents", () => {
        new GGContractClass("CloudsApi", {
            create: {input: IsObject({parent: Clouds.parentRef("cloud"), name: IsString}), errors: [SERVER_ERROR], permission: Clouds.Write.in("parent")},
        })
        expect(() => new GGContractClass("CloudsApi", {
            create: {input: IsObject({parent: IsObject({type: IsString, id: IsString})}), errors: [SERVER_ERROR], permission: Clouds.Write.in("parent")},
        })).toThrow("must be {type, id} with a literal type")
    })
})

const model = defineAuthzModel({
    partition: "acme",
    services: [Places, Clouds],
    roles: [
        defineAuthzRole("cloud-editor", {actions: [Clouds.Read, Clouds.Write]}),
        defineAuthzRole("admin", {actions: [Places.all, Clouds.all]}),
    ],
})
const engine = new GGAuthz({
    model,
    policies: {
        bindings: [
            {principal: "user:cleo", role: "admin", on: rn.org},
            {principal: "user:ann", role: "cloud-editor", on: rn.member("ann")},
            {principal: "user:ann", role: "cloud-editor", on: rn.project("web")},
        ],
    },
    resolver: new GGAuthzMemoryResolver({}),
})
const authority = new GGAuthzAuthority({partition: "acme", tenantType: Places.types.org, tenant: () => "acme", engine: async () => engine})
authority.register(Places.types.project, (_tenant, id) => ["web", "ml"].includes(id) ? {properties: {ancestors: [rn.org]}} : undefined)

const ann: GGAuthzSubject = {type: "user", id: "ann"}
const fail = (p: Promise<unknown>) => p.then(() => undefined, e => e)
const create = Clouds.Write.in("parent")

describe("GGAuthzAuthority deciding inside a parent", () => {
    test("decides the action on the parent the input names", async () => {
        await as(ann, () => authority.authorize(create, {parent: {type: Places.types.project, id: "web"}}))
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorize(create, {parent: {type: Places.types.project, id: "ml"}}))))).toBe(true)
        expect(FORBIDDEN.is(await fail(as(ann, () => authority.authorize(create, {parent: {type: Places.types.org, id: "acme"}}))))).toBe(true)
        await as({type: "user", id: "cleo"}, () => authority.authorize(create, {parent: {type: Places.types.org, id: "acme"}}))
    })

    test("a parent that doesn't resolve is NOT_FOUND; one of another type is a programming error", async () => {
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.authorize(create, {parent: {type: Places.types.project, id: "nope"}}))))).toBe(true)
        expect(NOT_FOUND.is(await fail(as(ann, () => authority.authorize(create, {parent: {type: Places.types.org, id: "other"}}))))).toBe(true)
        await expect(as(ann, () => authority.authorize(create, {parent: {type: Clouds.types.image, id: "x"}}))).rejects.toThrow("not a parent of clouds:cloud")
    })

    test("assertLoaders needs a loader for every parent type but the tenant's", () => {
        const Api = new GGContractClass("CloudsApi", {
            create: {input: IsObject({parent: Clouds.parentRef("cloud")}), errors: [SERVER_ERROR], permission: create},
        })
        expect(() => authority.assertLoaders([Api])).toThrow("CloudsApi.create: no loader for places:member, a parent of clouds:cloud")
    })
})
