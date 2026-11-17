import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGSharedSecret} from "@grest-ts/service-auth"
import {SharedSecretRuntime} from "../src/SharedSecretRuntime"
import {INTERNAL_SECRET_WIRE, SharedSecretApi, SharedSecretCallerApi} from "../src/api/SharedSecretApi"

function presenting(secret: string): GGContext {
    const scope = new GGContext("shared-secret-test")
    scope.set(INTERNAL_SECRET_WIRE, secret)
    return scope
}

describe("GGSharedSecret", () => {

    GGTest.startInline(SharedSecretRuntime)

    describe("verify", () => {
        test("accepts the configured secret", async () => {
            await callOn(SharedSecretApi, presenting("s3cret")).ping().toEqual("pong")
        })

        test("refuses a wrong secret", async () => {
            await callOn(SharedSecretApi, presenting("s3creT")).ping().toBeError(NOT_AUTHORIZED)
        })

        test("refuses a secret of another length", async () => {
            await callOn(SharedSecretApi, presenting("s3cret-and-more")).ping().toBeError(NOT_AUTHORIZED)
        })

        test("refuses a call without the header", async () => {
            await callOn(SharedSecretApi).ping().toBeError(NOT_AUTHORIZED)
        })

        test("can be called again for the same wire, as a compose() run per runtime instance does", () => {
            expect(GGSharedSecret.verify(INTERNAL_SECRET_WIRE)).toBe(GGSharedSecret.verify(INTERNAL_SECRET_WIRE))
        })
    })

    describe("attach", () => {
        test("a client sends its configured secret", async () => {
            await callOn(SharedSecretCallerApi).withRightSecret().toEqual("pong")
        })

        test("a client with a wrong secret is refused", async () => {
            await callOn(SharedSecretCallerApi).withWrongSecret().toBeError(NOT_AUTHORIZED)
        })
    })
})
