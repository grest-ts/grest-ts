import {SERVER_ERROR} from "@grest-ts/schema";
import {CreateTestRequest, CreateTestResponse, EventsTestApiContract, StartTestRequest} from "../api/EventsTestApi";
import {EventsTestEvents, tTestId} from "../events/EventsTestEvents";
import type {EventPublisherClient} from "@grest-ts/events";

type IEventsTestApi = typeof EventsTestApiContract.infer

export class EventsTestService implements IEventsTestApi {
    private testCounter = 0;
    private readonly eventsPublisher: EventPublisherClient<EventsTestEvents>;

    constructor(eventsPublisher: EventPublisherClient<EventsTestEvents>) {
        this.eventsPublisher = eventsPublisher;
    }

    public async publishSomething(request: CreateTestRequest): Promise<CreateTestResponse> {
        this.testCounter++;
        const testId = `test-${this.testCounter}` as tTestId;

        const publishResult = await this.eventsPublisher.publish("created", {
            testId,
            testName: request.testName,
            timestamp: Date.now(),
        }).asResult();

        if (!publishResult.success) {
            throw new SERVER_ERROR({displayMessage: "Failed to publish created event"});
        }

        return {
            testId,
            testName: request.testName
        };
    }

    public async publishSomethingElse(request: StartTestRequest): Promise<void> {
        const publishResult = await this.eventsPublisher.publish("started", {
            testId: request.testId,
            timestamp: Date.now(),
        }).asResult();

        if (!publishResult.success) {
            throw new SERVER_ERROR({displayMessage: "Failed to publish started event"});
        }
    }
}
