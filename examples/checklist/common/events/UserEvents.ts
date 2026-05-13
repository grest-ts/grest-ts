import {awsSnsPublisher} from "@grest-ts/events-aws";
import {GGContractClass, IsNumber, IsObject, IsString, GG_NO_PERMISSIONS } from "@grest-ts/schema";

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
    loggedIn: {input: IsUserLoggedInEvent,
        permission: GG_NO_PERMISSIONS
    },
    registered: {input: IsUserRegisteredEvent,
        permission: GG_NO_PERMISSIONS
    },
    passwordChanged: {input: IsUserPasswordChangedEvent,
        permission: GG_NO_PERMISSIONS
    }
})

export const UserEventsPublisher = awsSnsPublisher(UserEventsContract, "user_events")

export const UserEventsSubscriber = UserEventsPublisher.subscriber("blocker_user_events", {
    messageRetentionSeconds: 86400,
    deadLetterAfterRetries: 3,
    visibilityTimeoutDefault: 30
});
