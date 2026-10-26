import {describe, expect, it} from "vitest";
import {ERROR, SERVER_ERROR} from "../ERROR";
import {GGContractClass, type GGContractMethodErrors} from "../GGContractClass";
import {GGContractFunction} from "../GGContractFunction";
import {GGDuplexContract} from "../GGDuplexContract";
import {FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND} from "../standardErrors";
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
