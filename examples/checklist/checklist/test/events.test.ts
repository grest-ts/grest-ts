import {callOn, GGTest} from "@grest-ts/testkit";
import {SERVER_ERROR} from "@grest-ts/schema";
import {RegisterRequest, UserPublicApi} from "../../common/api-user-public/UserPublicApi";
import {ChecklistRuntime} from "../checklist";
import {BlockerRuntime} from "../../blocker/blocker";
import {ChecklistConfig} from "../ChecklistConfig";
import {BlockerConfig} from "../../blocker/BlockerConfig";
import {UserEventsPublisher, UserEventsSubscriber} from "../../common/events/UserEvents";
import {GGEventsMetrics, PublisherWarning, SubscriberWarning} from "@grest-ts/events";
import {postgresLocal as checklistDb} from "../config/local";
import {postgresLocal as blockerDb} from "../../blocker/config/local";

function userData(n: number): RegisterRequest {
    return {
        username: `evtuser${n}`,
        email: `evtuser${n}@example.com`,
        password: "secret123"
    } as RegisterRequest;
}

describe("Events testkit tests (SNS/SQS)", async () => {

    const t = GGTest.startWorker({checklist: ChecklistRuntime, blocker: BlockerRuntime});

    GGTest.with(ChecklistConfig.resources.postgres).clone({from: checklistDb});
    GGTest.with(BlockerConfig.db).clone({from: blockerDb});

    const api = callOn(UserPublicApi);

    // -------------------------------------------------
    // SNS Publisher tests
    // -------------------------------------------------

    test('register user publishes registered event via SNS', async () => {
        const user = userData(1);
        await api
            .register(user)
            .with(UserEventsPublisher.spy.registered
                .toMatchObject({username: user.username}))
            .toMatchObject({
                user: {username: user.username}
            });
    });

    test('login user publishes loggedIn event via SNS', async () => {
        const user = userData(2);
        await api.register(user);

        await api
            .login({username: user.username, password: "secret123"})
            .with(UserEventsPublisher.spy.loggedIn);
    });

    test('SNS spy validates event content', async () => {
        const user = userData(3);
        await api
            .register(user)
            .with(UserEventsPublisher.spy.registered
                .toMatchObject({
                    username: user.username,
                    timestamp: expect.any(Number)
                })
            );
    })

    test('SNS mock intercepts and blocks event delivery', async () => {
        await api
            .register(userData(4))
            .with(UserEventsPublisher.mock.registered.andReturn(undefined));
    });

    // -------------------------------------------------
    // SQS Subscriber tests (via log verification)
    // Note: SQS processing is async, so we verify via logs rather than interceptors
    // -------------------------------------------------

    test('SQS subscriber receives registered event from SNS', async () => {
        const user = userData(5);
        await api
            .register(user)
            .waitFor(t.blocker.logs.expect(new RegExp(`New user registered: ${user.username}`)));
    });

    test('SNS mock blocks delivery to SQS subscriber', async () => {
        const blockedUser = userData(106);
        const canaryUser = userData(107);

        // Mock blocks this registration
        await api
            .register(blockedUser)
            .with(UserEventsPublisher.mock.registered.andReturn(undefined));

        // Send a canary event that goes through normally
        // When canary's log appears, we know SQS processing has caught up
        await api
            .register(canaryUser)
            .waitFor(t.blocker.logs.expect(new RegExp(`New user registered: ${canaryUser.username}`)));

        // Now verify the blocked user's log never appeared (use word boundary for exact match)
        const logs = await t.blocker.logs.fromStart().retrieve();
        const blockerLog = logs.find(l => l.message?.includes(`New user registered: ${blockedUser.username} `));
        expect(blockerLog).toBeUndefined();
    });

    // -------------------------------------------------
    // Error handling tests
    // -------------------------------------------------

    test('registration fails when SNS publish returns error', async () => {
        const user = userData(7);
        await api
            .register(user)
            .with(UserEventsPublisher.mock.registered
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
                .register(userData(8))
                .with(UserEventsSubscriber.spy.registered);
        }).toThrow(/cannot be used with \.with\(\)/);
    });

    test('SQS mock with .with() throws helpful error', async () => {
        expect(() => {
            api
                .register(userData(9))
                .with(UserEventsSubscriber.mock.registered);
        }).toThrow(/cannot be used with \.with\(\)/);
    });

    // -------------------------------------------------
    // Contract validation tests
    // -------------------------------------------------

    test('SNS inject bypasses publisher validation and delivers to SQS', async () => {
        // Inject an event with invalid data (timestamp as string instead of number)
        // This bypasses SNS publisher validation
        await UserEventsPublisher.inject.registered({
            userId: "user-inject-1",
            username: "injectuser1",
            timestamp: "not-a-number"  // Invalid: should be number
        });

        // Wait for validation error log to appear
        await GGTest.waitFor(t.blocker.logs.expect(/[Vv]alidation failed/));
    });

    test('SQS inject bypasses SNS entirely and delivers to subscriber', async () => {
        // Inject directly to SQS queue with invalid data
        await UserEventsSubscriber.inject.registered({
            userId: "user-inject-2",
            username: "injectuser2",
            timestamp: "also-not-a-number"  // Invalid: should be number
        });

        // Wait for validation error log to appear
        await GGTest.waitFor(t.blocker.logs.expect(/[Vv]alidation failed/));
    });

    // -------------------------------------------------
    // Warning metrics tests
    // -------------------------------------------------

    test('MESSAGE_SIZE_NEAR_LIMIT warning triggers when threshold is set to 0', async () => {
        const configKey = ChecklistConfig.publisher.userEvents.settings
        await t.checklist.config.update(configKey, {messageSizeWarningRatio: 0});
        await api
            .register(userData(20))
            .with(t.checklist.metrics.expect(GGEventsMetrics.publisher.warnings).inc({provider: "aws_sns", topic: 'user_events', reason: PublisherWarning.MESSAGE_SIZE_NEAR_LIMIT}));
    });

    test('MESSAGE_AGE_HIGH warning triggers when threshold is set to 0', async () => {
        await t.blocker.config.update(BlockerConfig.subscriber.userEvents.settings, {messageAgeWarningMs: 0});
        const user = userData(21);
        await api
            .register(user)
            .with(UserEventsPublisher.spy.registered.toMatchObject({username: user.username, timestamp: expect.any(Number)}))
            .with(t.blocker.metrics.expect(GGEventsMetrics.subscriber.warnings).incAtLeast({provider: "aws_sqs", queue: 'blocker_user_events', reason: SubscriberWarning.MESSAGE_AGE_HIGH}))
            .with(t.blocker.logs.expect(`New user registered: ${user.username}`));
    });

    test('SNS publish increments published counter', async () => {
        const user = userData(22);
        await api
            .register(user)
            .with(t.checklist.metrics.expect(GGEventsMetrics.publisher.published).inc({provider: "aws_sns", topic: 'user_events', eventType: 'registered', result: 'OK'}));
    });

    test('SQS processed counter increments on message handling', async () => {
        const user = userData(23);
        await api
            .register(user)
            .with(t.blocker.metrics.expect(GGEventsMetrics.subscriber.processed).incAtLeast({provider: "aws_sqs", queue: 'blocker_user_events', eventType: 'registered', result: 'OK'}, 1))
            .with(t.blocker.logs.expect(`New user registered: ${user.username}`));
    });

});
