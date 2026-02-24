import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, GGContractImplementation, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsTestId = IsString.brand("TestId")
export type tTestId = typeof IsTestId.infer

export const IsCreateTestRequest = IsObject({
    testName: IsString
})
export type CreateTestRequest = typeof IsCreateTestRequest.infer

export const IsCreateTestResponse = IsObject({
    testId: IsTestId,
    testName: IsString
})
export type CreateTestResponse = typeof IsCreateTestResponse.infer

export const IsStartTestRequest = IsObject({
    testId: IsTestId
})
export type StartTestRequest = typeof IsStartTestRequest.infer

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const EventsTestApiContract = new GGContractClass("EventsTestApi", {
    publishSomething: {
        input: IsCreateTestRequest,
        success: IsCreateTestResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    publishSomethingElse: {
        input: IsStartTestRequest,
        success: undefined as undefined,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
})

export type IEventsTestApi = GGContractImplementation<typeof EventsTestApiContract["methods"]>

export const EventsTestApi = httpSchema(EventsTestApiContract)
    .pathPrefix("api/events-test")
    .routes({
        publishSomething: GGRpc.POST("create"),
        publishSomethingElse: GGRpc.POST("start")
    })
