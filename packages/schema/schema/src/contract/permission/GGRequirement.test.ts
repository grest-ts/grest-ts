import {describe, expect, it} from "vitest";
import {ERROR, SERVER_ERROR} from "../ERROR";
import {GGContractClass, type GGContractMethodErrors} from "../GGContractClass";
import {GGContractFunction} from "../GGContractFunction";
import {GGDuplexContract} from "../GGDuplexContract";
import {FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND} from "../standardErrors";
import {IsDiscriminated} from "../../schemas/IsDiscriminated";
import {IsLiteral} from "../../schemas/IsLiteral";
import {IsObject} from "../../schemas/IsObject";
import {IsString} from "../../schemas/IsString";
import {GG_NO_PERMISSIONS} from "./GGPermission";
import {GGPermissionChecker} from "./GGPermissionChecker";
import {byField, type GGRequirement, requirementField} from "./GGRequirement";
import type {GGRequirementErrors} from "./requirementMethod";

const APPROVAL_REQUIRED = ERROR.define("APPROVAL_REQUIRED", 403)
const ERRORS = [NOT_AUTHORIZED, FORBIDDEN, APPROVAL_REQUIRED] as const

// What a model library's builder returns.
type Errors = typeof ERRORS[number]
const on = <const F extends string>(action: string, type: string, field: F, extra?: Partial<GGRequirement<F, Errors>>): GGRequirement<F, Errors> =>
    Object.freeze({__permission: "requirement", action, resource: {type, id: {field}}, errors: ERRORS, ...extra})
const list = (action: string): GGRequirement<string, Errors> => Object.freeze({__permission: "requirement", action, list: true, errors: ERRORS})

describe("GGRequirement in permission checks", () => {

    it("fails closed where nothing decides it; scopesOf leaves what the grants must satisfy", () => {
        const r = on("docs:Read", "docs:doc", "docId")
        expect(GGPermissionChecker.satisfies(r, [["docs:Read"]])).toBe(false)
        expect(GGPermissionChecker.scopesOf(r)).toBe(GG_NO_PERMISSIONS)
        expect(GGPermissionChecker.scopesOf({allOf: [r, list("docs:Read")]})).toBe(GG_NO_PERMISSIONS)
        expect(GGPermissionChecker.scopesOf({allOf: ["admin", r]})).toEqual({allOf: ["admin"]})
        expect(GGPermissionChecker.scopesOf({anyOf: ["a", "b"]})).toEqual({anyOf: ["a", "b"]})
    })

    it("collects requirements from allOf and refuses them in anyOf", () => {
        const r = on("docs:Read", "docs:doc", "docId")
        expect(GGPermissionChecker.requirementsOf({allOf: ["admin", r]})).toEqual([r])
        expect(() => GGPermissionChecker.validatePermission({anyOf: ["admin", r]})).toThrow("can't sit inside anyOf")
    })

    it("describes the rule for docs and error messages", () => {
        expect(GGPermissionChecker.describePermission(on("docs:Write", "docs:doc", "docId", {hidden: true}))).toBe("docs:Write on docs:doc from input.docId (denied as NOT_FOUND)")
        expect(GGPermissionChecker.describePermission(list("docs:Read"))).toBe("docs:Read (lists what the caller may see)")
    })

    it("rejects a malformed requirement", () => {
        expect(() => GGPermissionChecker.validatePermission({__permission: "requirement", action: "", errors: []} as never)).toThrow("needs an action")
        expect(() => GGPermissionChecker.validatePermission({...list("docs:Read"), resource: {type: "docs:doc"}} as never)).toThrow("is a list")
        expect(() => GGPermissionChecker.validatePermission({__permission: "requirement", action: "docs:Read", resource: {type: "docs:doc", id: {}}, errors: []} as never)).toThrow("neither {field} nor {context}")
        expect(() => GGPermissionChecker.validatePermission(on("docs:Read", "docs:doc", "docId", {hidden: true}))).toThrow("must include NOT_FOUND")
    })
})

describe("GGRequirement on contracts", () => {

    it("adds the requirement's errors to the method's own", () => {
        const Docs = new GGContractClass("Docs", {
            read: {input: IsObject({docId: IsString}), errors: [NOT_FOUND, SERVER_ERROR], permission: on("docs:Read", "docs:doc", "docId")},
        })
        expect(Docs.methods.read.errors).toEqual([NOT_FOUND, SERVER_ERROR, NOT_AUTHORIZED, FORBIDDEN, APPROVAL_REQUIRED])

        // The client's error types include them too.
        const approval: GGContractMethodErrors<typeof Docs.methods.read>["type"] = "APPROVAL_REQUIRED"
        expect(approval).toBe("APPROVAL_REQUIRED")
        const added: GGRequirementErrors<typeof Docs.methods.read>["type"][] = ["NOT_AUTHORIZED", "FORBIDDEN", "APPROVAL_REQUIRED"]
        // @ts-expect-error only the requirement's own errors
        const other: GGRequirementErrors<typeof Docs.methods.read>["type"] = "NOT_FOUND"
        expect([...added, other]).toHaveLength(4)
    })

    it("refuses a field the input doesn't have, at build time and at compile time", () => {
        expect(() => new GGContractClass("Docs", {
            // @ts-expect-error the input has no docId
            read: {input: IsObject({id: IsString}), errors: [SERVER_ERROR], permission: on("docs:Read", "docs:doc", "docId")},
        })).toThrow("reads input.docId, which the input doesn't have")
    })

    it("refuses a field read from an optional input", () => {
        expect(() => new GGContractClass("Docs", {
            read: {input: IsObject({docId: IsString}).orUndefined, errors: [SERVER_ERROR], permission: on("docs:Read", "docs:doc", "docId")},
        })).toThrow("the input itself is optional")
    })

    it("refuses an optional id unless the requirement is an upsert", () => {
        const input = IsObject({docId: IsString.orUndefined, folderId: IsString})
        expect(() => new GGContractClass("Docs", {
            save: {input, errors: [SERVER_ERROR], permission: on("docs:Write", "docs:doc", "docId")},
        })).toThrow("which is optional")
        const Docs = new GGContractClass("Docs", {
            save: {input, errors: [SERVER_ERROR], permission: on("docs:Write", "docs:doc", "docId", {createOn: {type: "docs:folder", id: {field: "folderId"}}})},
        })
        expect(Docs.methods.save.errors).toContain(FORBIDDEN)
    })

    it("allows a list or a context-sourced resource without an input field", () => {
        new GGContractClass("Docs", {
            list: {errors: [SERVER_ERROR], permission: list("docs:Read")},
            mine: {errors: [SERVER_ERROR], permission: Object.freeze({__permission: "requirement", action: "docs:Read", resource: {type: "docs:shelf", id: {context: "caller"}}, errors: ERRORS}) as GGRequirement},
        })
    })

    it("checks single contract functions the same way", () => {
        const fn = new GGContractFunction({input: IsObject({docId: IsString}), errors: [SERVER_ERROR], permission: on("docs:Read", "docs:doc", "docId")})
        expect(fn.method.errors).toContain(APPROVAL_REQUIRED)
    })

    it("is refused on socket contracts, where no authority runs", () => {
        expect(() => new GGDuplexContract("Live", {
            connect: {errors: [SERVER_ERROR]},
            clientToServer: {watch: {input: IsObject({docId: IsString}), errors: [SERVER_ERROR], permission: on("docs:Read", "docs:doc", "docId")}},
            serverToClient: {},
        })).toThrow("requirements are only supported on HTTP methods")
    })
})

const IsShelf = IsDiscriminated("type", {
    org: IsObject({type: IsLiteral("org")}),
    project: IsObject({type: IsLiteral("project"), projectId: IsString}),
    member: IsObject({type: IsLiteral("member"), memberId: IsString}),
})
const ByShelf = byField(IsShelf, "type", {
    org: null,
    project: on("org:ReadProject", "org:project", "projectId"),
    member: on("org:ReadMember", "org:member", "memberId"),
})

describe("byField", () => {

    it("type-checks its cases against the union", () => {
        // @ts-expect-error no case for member
        byField(IsShelf, "type", {org: null, project: null})
        // @ts-expect-error team isn't a value of type
        byField(IsShelf, "type", {org: null, project: null, member: null, team: null})
        // @ts-expect-error the project variant has no memberId
        byField(IsShelf, "type", {org: null, project: on("org:ReadProject", "org:project", "memberId"), member: null})
        // @ts-expect-error no case to pick
        expect(() => ByShelf.pick(["team"])).toThrow("no case team to pick")
        expect(ByShelf.pick(["org", "member"]).cases).toEqual({org: null, member: ByShelf.cases.member})
    })

    it("lists every case's requirement, and runs only the one the input takes", () => {
        const p = {allOf: ["admin", ByShelf] as const}
        expect(GGPermissionChecker.requirementsOf(p)).toEqual([ByShelf.cases.project, ByShelf.cases.member])
        expect(GGPermissionChecker.requirementsFor(p, {type: "project", projectId: "p1"})).toEqual([ByShelf.cases.project])
        expect(GGPermissionChecker.requirementsFor(p, {type: "org"})).toEqual([])
        expect(() => GGPermissionChecker.requirementsFor(p, {type: "team"})).toThrow("No case for input.type")
        expect(GGPermissionChecker.scopesOf(p)).toEqual({allOf: ["admin"]})
        expect(ByShelf.errors).toEqual(ERRORS)
    })

    it("at: prefixes the discriminator and every case's fields", () => {
        const at = ByShelf.at("shelf")
        expect(at.field).toBe("shelf.type")
        expect(at.cases.project!.resource!.id).toEqual({field: "shelf.projectId"})
        expect(requirementField({shelf: {projectId: "p1"}}, "shelf.projectId")).toBe("p1")
        expect(GGPermissionChecker.describePermission(at)).toBe("by input.shelf.type: org → nothing more; project → org:ReadProject on org:project from input.shelf.projectId; member → org:ReadMember on org:member from input.shelf.memberId")
    })

    it("is refused inside anyOf, and without cases", () => {
        expect(() => GGPermissionChecker.validatePermission({anyOf: ["admin", ByShelf]})).toThrow("can't sit inside anyOf")
        expect(() => GGPermissionChecker.validatePermission({__permission: "byField", field: "type", cases: {}, errors: []} as never)).toThrow("at least one case")
    })
})

describe("byField on contracts", () => {

    it("checks the cases match the union and adds their errors", () => {
        const Shelves = new GGContractClass("Shelves", {
            read: {input: IsObject({shelf: IsShelf}), errors: [SERVER_ERROR], permission: ByShelf.at("shelf")},
            top: {input: IsShelf, errors: [SERVER_ERROR], permission: ByShelf},
        })
        expect(Shelves.methods.read.errors).toEqual([SERVER_ERROR, NOT_AUTHORIZED, FORBIDDEN, APPROVAL_REQUIRED])
        const added: GGRequirementErrors<typeof Shelves.methods.read>["type"] = "APPROVAL_REQUIRED"
        expect(added).toBe("APPROVAL_REQUIRED")
    })

    it("refuses a discriminator the input doesn't have, at build time and at compile time", () => {
        expect(() => new GGContractClass("Shelves", {
            // @ts-expect-error the input has no shelf
            read: {input: IsObject({box: IsShelf}), errors: [SERVER_ERROR], permission: ByShelf.at("shelf")},
        })).toThrow("reads input.shelf.type, which the input doesn't have")
        expect(() => new GGContractClass("Shelves", {
            read: {input: IsObject({shelf: IsShelf.orUndefined}), errors: [SERVER_ERROR], permission: ByShelf.at("shelf")},
        })).toThrow("which is optional")
    })

    it("refuses cases that don't match the input's variants", () => {
        const TwoShelves = IsDiscriminated("type", {org: IsObject({type: IsLiteral("org")}), project: IsObject({type: IsLiteral("project"), projectId: IsString})})
        expect(() => new GGContractClass("Shelves", {
            read: {input: IsObject({shelf: TwoShelves}), errors: [SERVER_ERROR], permission: ByShelf.at("shelf")},
        })).toThrow("has a case for member, which the input can't hold")
        new GGContractClass("Shelves", {
            read: {input: IsObject({shelf: TwoShelves}), errors: [SERVER_ERROR], permission: ByShelf.pick(["org", "project"]).at("shelf")},
            one: {input: IsObject({shelf: IsObject({type: IsLiteral("member"), memberId: IsString})}), errors: [SERVER_ERROR], permission: ByShelf.pick(["member"]).at("shelf")},
        })
        expect(() => new GGContractClass("Shelves", {
            read: {input: IsObject({shelf: IsShelf}), errors: [SERVER_ERROR], permission: ByShelf.pick(["org", "project"]).at("shelf")},
        })).toThrow("has no case for member")
    })

    it("refuses a case reading a field its variant lacks", () => {
        const Mixed = IsDiscriminated("type", {
            org: IsObject({type: IsLiteral("org")}),
            project: IsObject({type: IsLiteral("project"), projectId: IsString}),
            member: IsObject({type: IsLiteral("member"), memberId: IsString}),
        })
        const wrong = {__permission: "byField", field: "type", errors: ERRORS, cases: {org: null, project: on("org:ReadProject", "org:project", "memberId"), member: null}} as never
        expect(() => new GGContractClass("Shelves", {read: {input: Mixed, errors: [SERVER_ERROR], permission: wrong}})).toThrow("(case project): the requirement reads input.memberId, which the input doesn't have")
    })
})

describe("dotted requirement fields", () => {

    it("read nested input fields, checked at build time and at compile time", () => {
        new GGContractClass("Docs", {
            read: {input: IsObject({doc: IsObject({docId: IsString})}), errors: [SERVER_ERROR], permission: on("docs:Read", "docs:doc", "doc.docId")},
        })
        expect(() => new GGContractClass("Docs", {
            // @ts-expect-error doc has no id
            read: {input: IsObject({doc: IsObject({docId: IsString})}), errors: [SERVER_ERROR], permission: on("docs:Read", "docs:doc", "doc.id")},
        })).toThrow("reads input.doc.id, which the input doesn't have")
        expect(() => new GGContractClass("Docs", {
            read: {input: IsObject({doc: IsObject({docId: IsString}).orUndefined}), errors: [SERVER_ERROR], permission: on("docs:Read", "docs:doc", "doc.docId")},
        })).toThrow("which is optional")
        expect(() => new GGContractClass("Docs", {
            // @ts-expect-error only the project variant has projectId
            read: {input: IsObject({shelf: IsShelf}), errors: [SERVER_ERROR], permission: on("org:ReadProject", "org:project", "shelf.projectId")},
        })).toThrow("reads input.shelf.projectId, which the input doesn't have")
    })
})
