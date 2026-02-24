import {callOn, GGTest} from "@grest-ts/testkit";
import {SERVER_ERROR} from "@grest-ts/schema";
import {CreateTestRequest, EventsTestApi} from "../src/api/EventsTestApi";
import {MainRuntime} from "../src/main";
import {SubRuntime} from "../src/sub";
import {MainConfigApi} from "../src/MainConfig.api";
import {SubConfigApi} from "../src/SubConfig.api";
import {EventsTestPublisher, EventsTestSubscriber} from "../src/events/EventsTestEvents";
import {GGEventsMetrics, PublisherWarning, SubscriberWarning} from "@grest-ts/events";

function testData(n: number): CreateTestRequest {
    return {testName: `evttest${n}`};
}

describe.shuffle("Events testkit tests (SNS/SQS)", async () => {

    const t = GGTest.startWorker({
        main: MainRuntime,
        sub: SubRuntime
    });

    const api = callOn(EventsTestApi);

    // -------------------------------------------------
    // SNS Publisher tests
    // -------------------------------------------------

    test('create test publishes created event via SNS', async () => {
        const testReq = testData(1);
        await api
            .publishSomething(testReq)
            .with(EventsTestPublisher.spy.created
                .toMatchObject({testName: testReq.testName}))
            .toMatchObject({
                testName: testReq.testName
            });
    });

    test('start test publishes started event via SNS', async () => {
        const testReq = testData(2);
        const created = await api.publishSomething(testReq);

        await api
            .publishSomethingElse({testId: created.testId})
            .with(EventsTestPublisher.spy.started);
    });

    test('SNS spy validates event content', async () => {
        const testReq = testData(3);
        await api
            .publishSomething(testReq)
            .with(EventsTestPublisher.spy.created
                .toMatchObject({
                    testName: testReq.testName,
                    timestamp: expect.any(Number)
                })
            );
    });

    test('SNS mock intercepts and blocks event delivery', async () => {
        await api
            .publishSomething(testData(4))
            .with(EventsTestPublisher.mock.created.andReturn(undefined));
    });

    // -------------------------------------------------
    // SQS Subscriber tests (via log verification)
    // Note: SQS processing is async, so we verify via logs rather than interceptors
    // -------------------------------------------------

    test('SQS subscriber receives created event from SNS', async () => {
        const testReq = testData(5);
        await api
            .publishSomething(testReq)
            .waitFor(t.sub.logs.expect(new RegExp(`Test created: ${testReq.testName}`)));
    });

    test('SNS mock blocks delivery to SQS subscriber', async () => {
        const blockedTest = testData(106);
        const canaryTest = testData(107);

        // Mock blocks this publish
        await api
            .publishSomething(blockedTest)
            .with(EventsTestPublisher.mock.created.andReturn(undefined));

        // Send a canary event that goes through normally
        // When canary's log appears, we know SQS processing has caught up
        await api
            .publishSomething(canaryTest)
            .waitFor(t.sub.logs.expect(new RegExp(`Test created: ${canaryTest.testName}`)));

        // Now verify the blocked test's log never appeared (use trailing space for exact match)
        const logs = await t.sub.logs.fromStart().retrieve();
        const subscriberLog = logs.find(l => l.message?.includes(`Test created: ${blockedTest.testName} `));
        expect(subscriberLog).toBeUndefined();
    });

    // -------------------------------------------------
    // Error handling tests
    // -------------------------------------------------

    test('creation fails when SNS publish returns error', async () => {
        const testReq = testData(7);
        await api
            .publishSomething(testReq)
            .with(EventsTestPublisher.mock.created
                .times(3) // SnsPublisherClient retries 3 times
                .andReturn(new SERVER_ERROR()))
            .toBeError(SERVER_ERROR);
    });

    // -------------------------------------------------
    // API guard tests
    // -------------------------------------------------

    test('SQS spy with .with() throws helpful error', async () => {
        expect(() => {
            api
                .publishSomething(testData(8))
                .with(EventsTestSubscriber.spy.created);
        }).toThrow(/cannot be used with \.with\(\)/);
    });

    test('SQS mock with .with() throws helpful error', async () => {
        expect(() => {
            api
                .publishSomething(testData(9))
                .with(EventsTestSubscriber.mock.created);
        }).toThrow(/cannot be used with \.with\(\)/);
    });

    // -------------------------------------------------
    // Contract validation tests
    // -------------------------------------------------

    test('SNS inject bypasses publisher validation and delivers to SQS', async () => {
        // Inject an event with invalid data (timestamp as string instead of number)
        // This bypasses SNS publisher validation
        await EventsTestPublisher.inject.created({
            testId: "test-inject-1",
            testName: "injecttest1",
            timestamp: "not-a-number"  // Invalid: should be number
        });

        // Wait for validation error log to appear
        await GGTest.waitFor(t.sub.logs.expect(/[Vv]alidation failed/));
    });

    test('SQS inject bypasses SNS entirely and delivers to subscriber', async () => {
        // Inject directly to SQS queue with invalid data
        await EventsTestSubscriber.inject.created({
            testId: "test-inject-2",
            testName: "injecttest2",
            timestamp: "also-not-a-number"  // Invalid: should be number
        });

        // Wait for validation error log to appear
        await GGTest.waitFor(t.sub.logs.expect(/[Vv]alidation failed/));
    });

    // -------------------------------------------------
    // Warning metrics tests
    // -------------------------------------------------

    test('MESSAGE_SIZE_NEAR_LIMIT warning triggers when threshold is set to 0', async () => {
        const configKey = MainConfigApi.publisher.eventsTest.settings;
        await t.main.config.update(configKey, {messageSizeWarningRatio: 0});

        await api
            .publishSomething(testData(20))
            .with(t.main.metrics.expect(GGEventsMetrics.publisher.warnings).inc({topic: 'events_test', provider: 'aws_sns', reason: PublisherWarning.MESSAGE_SIZE_NEAR_LIMIT}));
    });

    test('MESSAGE_AGE_HIGH warning triggers when threshold is set to 0', async () => {

        await t.sub.config.update(SubConfigApi.subscriber.eventsTest.settings, {messageAgeWarningMs: 0});

        const testReq = testData(21);
        await api
            .publishSomething(testReq)
            .with(
                EventsTestPublisher.spy.created
                    .toMatchObject({testName: testReq.testName, timestamp: expect.any(Number)}),
                t.sub.metrics.expect(GGEventsMetrics.subscriber.warnings)
                    .incAtLeast({queue: 'events_subscriber', provider: 'aws_sqs', reason: SubscriberWarning.MESSAGE_AGE_HIGH}),
                t.sub.logs
                    .expect(`Test created: ${testReq.testName}`)
            )
    });
    // IDEA about having more clear AAA or given-then-when.
    // test('MESSAGE_AGE_HIGH warning triggers when threshold is set to 0', async () => {
    //
    //     await t.sub.config.update(SubConfigApi.subscriber.eventsTest.settings, {messageAgeWarningMs: 0});
    //
    //     const testReq = testData(21);
    //
    //     const spy = EventsTestPublisher.created.spy(); // registers to GGTestRunner
    //     const metricsChange = t.sub.metrics.pointer() // registers to GGTestRunner
    //     const logsPointer = t.sub.logs.pointer() // registers to GGTestRunner
    //
    //     await api.publishSomething(testReq) // checks what test has registered -> sets things up -> runs action -> clears registered things. Only test now has pointers to objects for checks.
    //
    //     expect(spy).toBeCalledWith({testName: testReq.testName, timestamp: expect.any(Number)})
    //     expect(metricsChange).incAtLeast({queue: 'events_subscriber', provider: 'aws_sqs', reason: SubscriberWarning.MESSAGE_AGE_HIGH})
    //     expect(logsPointer).toContainLine(`Test created: ${testReq.testName}`)
    //
    // });

    test('SNS publish increments published counter', async () => {
        const testReq = testData(22);
        await api
            .publishSomething(testReq)
            .with(t.main.metrics.expect(GGEventsMetrics.publisher.published).inc({topic: 'events_test', provider: 'aws_sns', eventType: 'created', result: 'OK'}));
    });

    test('SQS processed counter increments on message handling', async () => {
        const testReq = testData(23);
        await api
            .publishSomething(testReq)
            .with(t.sub.metrics.expect(GGEventsMetrics.subscriber.processed).incAtLeast({queue: 'events_subscriber', provider: 'aws_sqs', eventType: 'created', result: 'OK'}, 1))
            .with(t.sub.logs.expect(`Test created: ${testReq.testName}`));
    });

});
