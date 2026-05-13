import {awsSnsPublisher} from "@grest-ts/events-aws";
import {GGContractClass, IsNumber, IsObject, IsString, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsTestId} from "../api/EventsTestApi";
import {GGEventApi} from "@grest-ts/events"

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsTestCreatedEvent = IsObject({
    testId: IsTestId,
    testName: IsString,
    timestamp: IsNumber
})
export type TestCreatedEvent = typeof IsTestCreatedEvent.infer

export const IsTestStartedEvent = IsObject({
    testId: IsTestId,
    timestamp: IsNumber
})
export type TestStartedEvent = typeof IsTestStartedEvent.infer

export const IsTestCompletedEvent = IsObject({
    testId: IsTestId,
    timestamp: IsNumber
})
export type TestCompletedEvent = typeof IsTestCompletedEvent.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const EventsTestEventsContract = new GGContractClass("EventsTestEvents", {
    created: {input: IsTestCreatedEvent,
        permission: GG_NO_PERMISSIONS
    },
    started: {input: IsTestStartedEvent,
        permission: GG_NO_PERMISSIONS
    },
    completed: {input: IsTestCompletedEvent,
        permission: GG_NO_PERMISSIONS
    }
})

export type EventsTestEvents = GGEventApi<typeof EventsTestEventsContract["methods"]>
export type tTestId = typeof IsTestId.infer

export const EventsTestPublisher = awsSnsPublisher(EventsTestEventsContract, "events_test")

export const EventsTestSubscriber = EventsTestPublisher.subscriber("events_subscriber", {
    messageRetentionSeconds: 86400,
    deadLetterAfterRetries: 3,
    visibilityTimeoutDefault: 30
});
