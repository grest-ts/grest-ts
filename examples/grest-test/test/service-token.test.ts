import {callOn, GGTest} from "@grest-ts/testkit"
import {GGOAuthServiceApi} from "@grest-ts/oauth"
import {FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"
import {ServiceTokenAuthRuntime, ServiceTokenCallerRuntime, ServiceTokenTargetRuntime} from "../src/ServiceTokenRuntime"
import {ServiceTokenApi, ServiceTokenCallerApi} from "../src/api/ServiceTokenApi"

describe("service token: target mocked, no authorization server", () => {
    GGTest.startWorker(ServiceTokenCallerRuntime)

    test("the call carries a placeholder token, which the mock doesn't check", async () => {
        await callOn(ServiceTokenCallerApi).callTarget()
            .with(ServiceTokenApi.mock.whoami.andReturn("mocked"))
            .toEqual("mocked")
    })

    test("a long-lived token one test mocked...", async () => {
        await callOn(ServiceTokenCallerApi).callTarget()
            .with(GGOAuthServiceApi.mock.token.andReturn({token: "long-lived", expiresAt: Date.now() + 3600_000}))
            .with(ServiceTokenApi.mock.whoami.andReturn("mocked"))
            .toEqual("mocked")
    })

    test("...isn't reused by the next: its own mock of the token call answers", async () => {
        await callOn(ServiceTokenCallerApi).callTarget()
            .with(GGOAuthServiceApi.mock.token.andReturn(new FORBIDDEN()).times(1))
            .with(ServiceTokenApi.mock.whoami.andReturn("mocked").times(0))
            .toBeError(SERVER_ERROR)
    })

    test("once that mock is gone, placeholders are back", async () => {
        await callOn(ServiceTokenCallerApi).callTarget()
            .with(ServiceTokenApi.mock.whoami.andReturn("mocked again"))
            .toEqual("mocked again")
    })
})

describe("service token: caller, target and authorization server running", () => {
    GGTest.startWorker([ServiceTokenAuthRuntime, ServiceTokenTargetRuntime, ServiceTokenCallerRuntime])

    test("the target verifies a real token and sees the caller", async () => {
        await callOn(ServiceTokenCallerApi).callTarget().toEqual("caller")
    })
})

describe("service token: caller and target running, no authorization server", () => {
    GGTest.startWorker([ServiceTokenTargetRuntime, ServiceTokenCallerRuntime])

    test("a real target refuses the placeholder", async () => {
        await callOn(ServiceTokenCallerApi).callTarget().toBeError(NOT_AUTHORIZED)
    })
})
