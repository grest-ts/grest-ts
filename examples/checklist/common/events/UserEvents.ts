import {awsSnsPublisher} from "@grest-ts/events-aws";
import {GGContractClass, IsNumber, IsObject, IsString} from "@grest-ts/schema";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

const IsUserId = IsString.brand("UserId")

export const IsUserLoggedInEvent = IsObject({
    userId: IsUserId,
    timestamp: IsNumber
})

export const IsUserRegisteredEvent = IsObject({
    userId: IsUserId,
    username: IsString,
    timestamp: IsNumber
})

export const IsUserPasswordChangedEvent = IsObject({
    userId: IsUserId,
    timestamp: IsNumber
})

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const UserEventsContract = new GGContractClass("UserEvents", {
    loggedIn: {input: IsUserLoggedInEvent},
    registered: {input: IsUserRegisteredEvent},
    passwordChanged: {input: IsUserPasswordChangedEvent}
})

export const UserEventsPublisher = awsSnsPublisher(UserEventsContract, "user_events")

export const UserEventsSubscriber = UserEventsPublisher.subscriber("blocker_user_events", {
    messageRetentionSeconds: 86400,
    deadLetterAfterRetries: 3,
    visibilityTimeoutDefault: 30
});
