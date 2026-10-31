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
import type {GGRequirement} from "./GGRequirement";
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
})
const PLACES = ["org:org", "org:project", "org:member"]
const IsPlace = IsObject({type: IsLiteral("org:org", "org:project", "org:member"), id: IsString})
const within = <const F extends string>(action: string, field: F, types = PLACES): GGRequirement<F, Errors> =>
    Object.freeze({__permission: "requirement", action, resource: {type: "docs:doc", in: {field, types}}, errors: ERRORS})

describe("requirements inside a parent", () => {

    it("check the parent field at build time and at compile time, and add their errors", () => {
        const Docs = new GGContractClass("Docs", {
            create: {input: IsObject({parent: IsPlace, title: IsString}), errors: [SERVER_ERROR], permission: within("docs:Write", "parent")},
            narrower: {input: IsObject({parent: IsObject({type: IsLiteral("org:member"), id: IsString})}), errors: [SERVER_ERROR], permission: within("docs:Write", "parent")},
        })
        expect(Docs.methods.create.errors).toEqual([SERVER_ERROR, NOT_AUTHORIZED, FORBIDDEN, APPROVAL_REQUIRED])
        expect(() => new GGContractClass("Docs", {
            // @ts-expect-error the input has no parent
            create: {input: IsObject({place: IsPlace}), errors: [SERVER_ERROR], permission: within("docs:Write", "parent")},
        })).toThrow("reads input.parent, which the input doesn't have")
        expect(() => new GGContractClass("Docs", {
            create: {input: IsObject({parent: IsPlace.orUndefined}), errors: [SERVER_ERROR], permission: within("docs:Write", "parent")},
        })).toThrow("which is optional")
        expect(() => new GGContractClass("Docs", {
            create: {input: IsObject({parent: IsPlace.orNull}), errors: [SERVER_ERROR], permission: within("docs:Write", "parent")},
        })).toThrow("which is nullable")
        expect(() => new GGContractClass("Docs", {
            create: {input: IsObject({parent: IsString}), errors: [SERVER_ERROR], permission: within("docs:Write", "parent")},
        })).toThrow("must be {type, id} with a literal type")
        expect(() => new GGContractClass("Docs", {
            create: {input: IsObject({parent: IsPlace}), errors: [SERVER_ERROR], permission: within("docs:Write", "parent", ["org:org"])},
        })).toThrow("input.parent may name org:project, org:member, which the requirement's type can't be in (org:org)")
    })

    it("describe and validate", () => {
        expect(GGPermissionChecker.describePermission(within("docs:Write", "parent"))).toBe("docs:Write on docs:doc in input.parent (org:org | org:project | org:member)")
        expect(() => GGPermissionChecker.validatePermission({...within("docs:Write", "parent"), resource: {type: "docs:doc", in: {field: "parent", types: []}}} as never)).toThrow("an `in` that is not {field, types}")
        expect(() => GGPermissionChecker.validatePermission({...within("docs:Write", "parent"), resource: {type: "docs:doc", id: {field: "docId"}, in: {field: "parent", types: PLACES}}} as never)).toThrow("both an id and `in`")
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
        expect(() => new GGContractClass("Docs", {
            // @ts-expect-error a path can't pass through a union, even to a field every variant has
            read: {input: IsObject({shelf: IsShelf}), errors: [SERVER_ERROR], permission: on("org:Read", "org:org", "shelf.type")},
        })).toThrow("reads input.shelf.type, which the input doesn't have")
    })
})
