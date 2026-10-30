import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {SharedSecretUnconfiguredRuntime} from "../src/SharedSecretRuntime"
import {INTERNAL_SECRET_WIRE, SharedSecretApi} from "../src/api/SharedSecretApi"

function presenting(secret: string): GGContext {
    const scope = new GGContext("shared-secret-unconfigured-test")
    scope.set(INTERNAL_SECRET_WIRE, secret)
    return scope
}

describe("GGSharedSecret with an empty configured secret", () => {
    GGTest.startInline(SharedSecretUnconfiguredRuntime)

    test("refuses every call", async () => {
        await callOn(SharedSecretApi, presenting("")).ping().toBeError(NOT_AUTHORIZED)
        await callOn(SharedSecretApi, presenting("anything")).ping().toBeError(NOT_AUTHORIZED)
    })
})
