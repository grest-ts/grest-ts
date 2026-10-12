import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {WireAuthLateCreateRuntime} from "../src/WireAuthLateCreateRuntime"
import {USER_TOKEN_WIRE, WireUserApi} from "../src/api/WireAuthApi"

describe("wire handler created after its schema is registered", () => {

    GGTest.startInline(WireAuthLateCreateRuntime)

    function asUser(token: string): GGContext {
        const scope = new GGContext("late-create-test")
        scope.set(USER_TOKEN_WIRE, token)
        return scope
    }

    test("its permissions still reach the gate", async () => {
        expect(await callOn(WireUserApi, asUser("alice")).adminOnly()).toBe("admin-ok:alice")
    })

    test("and still deny a non-holder", async () => {
        await expect(callOn(WireUserApi, asUser("bob")).adminOnly()).rejects.toThrow(/FORBIDDEN/)
    })
})
