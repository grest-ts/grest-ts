import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {FORBIDDEN, NOT_FOUND, VALIDATION_ERROR} from "@grest-ts/schema"
import {afterEach} from "vitest"
import {RequirementDocsApi, RequirementDocsApiContract} from "../src/api/RequirementApi"
import {USER_TOKEN_WIRE} from "../src/api/WireAuthApi"
import {RequirementRuntime} from "../src/RequirementRuntime"
import {AUTHORITY_SEEN} from "../src/RequirementService"
import {RequirementMissingAuthorityRuntime} from "../src/RequirementMissingAuthorityRuntime"

function as(user: string): GGContext {
    const scope = new GGContext("requirement-test")
    scope.set(USER_TOKEN_WIRE, user)
    return scope
}

describe("requirements — HTTP end-to-end", () => {

    GGTest.startInline(RequirementRuntime)

    let scope: GGContext | undefined
    afterEach(async () => {
        scope?.reset()
        scope = undefined
        AUTHORITY_SEEN.splice(0)
    })

    test("the authority allows: the handler runs", async () => {
        scope = as("alice")
        expect(await callOn(RequirementDocsApi, scope).read({docId: "d1"})).toBe("read:d1")
    })

    test("the authority refuses a hidden resource as NOT_FOUND", async () => {
        scope = as("alice")
        await callOn(RequirementDocsApi, scope).read({docId: "d2"}).toBeError(NOT_FOUND)
    })

    test("the authority sees the validated input, and invalid input never reaches it", async () => {
        scope = as("alice")
        await callOn(RequirementDocsApi, scope).publish({docId: "d1", text: ""}).toBeError(VALIDATION_ERROR)
        expect(AUTHORITY_SEEN.splice(0)).toEqual([])
        expect(await callOn(RequirementDocsApi, scope).publish({docId: "d1", text: "hi"})).toBe("published:d1")
        expect(AUTHORITY_SEEN.splice(0)).toEqual([`docs:Write {"docId":"d1","text":"hi"}`])
    })

    test("allOf: the wire's permission is checked first, before the input is read", async () => {
        scope = as("bob") // may write d1, but lacks WIRE_ADMIN
        await callOn(RequirementDocsApi, scope).publish({docId: "d1", text: "hi"}).toBeError(FORBIDDEN)
        expect(AUTHORITY_SEEN.splice(0)).toEqual([])
    })

    test("upsert: an id checks the resource, no id checks the parent", async () => {
        scope = as("alice")
        expect(await callOn(RequirementDocsApi, scope).save({docId: "d1", folderId: "f9"})).toBe("updated:d1")
        expect(await callOn(RequirementDocsApi, scope).save({folderId: "f1"})).toBe("created-in:f1")
        await callOn(RequirementDocsApi, scope).save({folderId: "f9"}).toBeError(FORBIDDEN)
    })

    test("in: decided on the parent the input names", async () => {
        scope = as("alice")
        expect(await callOn(RequirementDocsApi, scope).file({docId: "d1", place: {type: "docs:folder", id: "f1"}})).toBe("filed:d1:docs:folder")
        expect(AUTHORITY_SEEN.splice(0).map(s => s.split(" ")[0])).toEqual(["docs:Write", "docs:Write"])
        await callOn(RequirementDocsApi, scope).file({docId: "d1", place: {type: "docs:folder", id: "f9"}}).toBeError(FORBIDDEN)
        expect(await callOn(RequirementDocsApi, scope).file({docId: "d1", place: {type: "docs:desk", id: "alice"}})).toBe("filed:d1:docs:desk")
        await callOn(RequirementDocsApi, scope).file({docId: "d1", place: {type: "docs:desk", id: "bob"}}).toBeError(FORBIDDEN)
        AUTHORITY_SEEN.splice(0)
    })

    test("list: the authority is asked, with no resource", async () => {
        scope = as("bob")
        expect(await callOn(RequirementDocsApi, scope).list()).toEqual(["d1"])
        expect(AUTHORITY_SEEN.splice(0)).toEqual(["docs:Read null"])
    })

    test("the requirement's errors are on the contract", () => {
        expect(RequirementDocsApiContract.methods.read.errors.map(e => e.TYPE)).toEqual(["VALIDATION_ERROR", "SERVER_ERROR", "NOT_AUTHORIZED", "FORBIDDEN", "NOT_FOUND"])
    })
})

describe("requirements — startup enforcement", () => {

    test("a .use()d authority with no .create() refuses to start", async () => {
        let caught: unknown
        try {
            await GGTest.startInline(RequirementMissingAuthorityRuntime)
        } catch (e) {
            caught = e
        }
        expect((caught as Error)?.message ?? String(caught)).toMatch(/authority "docs" is not created/)
    })
})
