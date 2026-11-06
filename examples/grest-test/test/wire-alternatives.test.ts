import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {afterEach} from "vitest"
import {WireAuthRuntime} from "../src/WireAuthRuntime"
import {AGENT_TOKEN_WIRE, AGENT_WORKSPACE_WIRE, USER_TOKEN_WIRE, WireEitherApi} from "../src/api/WireAuthApi"

describe("alternative wires: a user token OR an agent token", () => {

    GGTest.startInline(WireAuthRuntime)

    let scope: GGContext | undefined
    afterEach(() => {
        scope?.reset()
        scope = undefined
    })

    function as(values: {user?: string, agent?: string, workspace?: string}): GGContext {
        scope = new GGContext("wire-alternatives-test")
        if (values.user) scope.set(USER_TOKEN_WIRE, values.user)
        if (values.agent) scope.set(AGENT_TOKEN_WIRE, values.agent)
        if (values.workspace) scope.set(AGENT_WORKSPACE_WIRE, values.workspace)
        return scope
    }

    test("the user group authenticates a user", async () => {
        expect(await callOn(WireEitherApi, as({user: "alice"})).whoami()).toBe("user:alice")
    })

    test("the agent group authenticates an agent", async () => {
        expect(await callOn(WireEitherApi, as({agent: "agent-secret", workspace: "ws-1"})).whoami()).toBe("agent:ws-1")
    })

    test("with neither, the first group refuses (NOT_AUTHORIZED)", async () => {
        await expect(callOn(WireEitherApi).whoami()).rejects.toThrow(/NOT_AUTHORIZED/)
    })

    test("a bad credential in the chosen group refuses; no fallback to another group", async () => {
        await expect(callOn(WireEitherApi, as({agent: "wrong", workspace: "ws-1"})).whoami()).rejects.toThrow(/NOT_AUTHORIZED/)
    })

    test("with both, the first group wins and the other group's values are dropped", async () => {
        expect(await callOn(WireEitherApi, as({user: "alice", workspace: "ws-1"})).whoami()).toBe("user:alice")
    })

    test("only the chosen group's wires grant permissions", async () => {
        expect(await callOn(WireEitherApi, as({user: "alice"})).adminOnly()).toBe("admin-ok:alice")
        await expect(callOn(WireEitherApi, as({agent: "agent-secret", workspace: "ws-1"})).adminOnly()).rejects.toThrow(/FORBIDDEN/)
    })
})
