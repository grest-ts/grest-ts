import {GGConfig} from "@grest-ts/config";
import {EventsTestSubscriber} from "./events/EventsTestEvents";

export const SubConfigApi = GGConfig.define("/events_subscriber/", () => ({
    subscriber: {
        eventsTest: EventsTestSubscriber.config({
            batchSize: 20
        })
    }
}))
