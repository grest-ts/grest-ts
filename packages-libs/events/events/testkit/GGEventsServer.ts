import {GGTestComponent, GGTestRunner} from "@grest-ts/testkit";
import {GGEventsIPC} from "./GGEventsCommands";
import type {GGEventsInterceptor} from "./GGEventsInterceptor";

interface QueueMessage {
    messageId: string;
    body: any;
    receiptHandle: string;
    receivedCount: number;
    sentTimestamp: number;
}

interface QueueSubscription {
    serviceName: string;
    topicName: string;
    queueName: string;
    runtimeId: string;
}

export class GGEventsServer implements GGTestComponent {

    private readonly runner: GGTestRunner;
    private readonly interceptors: Map<string, GGEventsInterceptor> = new Map();

    // Queue subscriptions: which queues subscribe to which topics
    private readonly subscriptions: QueueSubscription[] = [];

    // Message storage: queueName -> messages
    private readonly queues: Map<string, QueueMessage[]> = new Map();

    // Message ID counter
    private messageIdCounter = 0;

    // Pending message completion promises: receiptHandle -> resolve function
    private readonly pendingMessages: Map<string, () => void> = new Map();

    constructor(runner: GGTestRunner) {
        this.runner = runner;
        const server = runner.ipcServer;

        // Register SQS subscription to a topic
        server.onFrameworkMessage(GGEventsIPC.test.sqsRegister, async (data) => {
            this.subscriptions.push({
                runtimeId: data.runtimeId,
                serviceName: data.serviceName,
                topicName: data.topicName,
                queueName: data.queueName
            });
            // Ensure queue exists
            if (!this.queues.has(data.queueName)) {
                this.queues.set(data.queueName, []);
            }
        });

        // Publish message to SNS topic
        server.onFrameworkMessage(GGEventsIPC.test.snsPublish, async (data) => {
            const messageId = `msg-${++this.messageIdCounter}`;

            // Check for SNS interceptor matching this event type
            const snsInterceptor = this.findInterceptor('sns', data.topicName, data.message);

            if (snsInterceptor) {
                const mockResult = await snsInterceptor.onRequest(data.message);
                if (!snsInterceptor.passThrough) {
                    // Mock mode - return mock result or default messageId
                    // If mock returns an error object, propagate it
                    if (mockResult && mockResult.success === false) {
                        return mockResult as any;
                    }
                    return {messageId};
                }
            }

            // Fan out to all subscribed queues
            const subscribers = this.subscriptions.filter(s => s.topicName === data.topicName);
            for (const sub of subscribers) {
                await this.deliverToQueue(sub, messageId, data.message);
            }

            if (snsInterceptor?.passThrough) {
                await snsInterceptor.onResponse({messageId});
            }

            return {messageId};
        });

        // Poll messages from SQS queue
        server.onFrameworkMessage(GGEventsIPC.test.sqsPoll, async (data) => {
            const queue = this.queues.get(data.queueName) ?? [];

            // Filter out messages that exceeded max receive count (simulates DLQ)
            const maxReceiveCount = 3;
            const availableMessages = queue.filter(m => m.receivedCount < maxReceiveCount);

            // Take up to maxMessages from available
            const messagesToReturn = availableMessages.slice(0, data.maxMessages);

            // Increment receive count
            for (const m of messagesToReturn) {
                m.receivedCount++;
            }

            // Call matching interceptor for each message
            for (const m of messagesToReturn) {
                const sqsInterceptor = this.findInterceptor('sqs', data.queueName, m.body);
                if (sqsInterceptor) {
                    await sqsInterceptor.onRequest(m.body);
                }
            }

            return {
                messages: messagesToReturn.map(m => ({
                    messageId: m.messageId,
                    body: m.body,
                    receiptHandle: m.receiptHandle,
                    sentTimestamp: m.sentTimestamp
                }))
            };
        });

        // Delete message from SQS queue
        server.onFrameworkMessage(GGEventsIPC.test.sqsDelete, async (data) => {
            const queue = this.queues.get(data.queueName);
            if (queue) {
                const index = queue.findIndex(m => m.receiptHandle === data.receiptHandle);
                if (index !== -1) {
                    queue.splice(index, 1);
                }
            }
            // Resolve the pending promise to signal message processing is complete
            const resolve = this.pendingMessages.get(data.receiptHandle);
            if (resolve) {
                this.pendingMessages.delete(data.receiptHandle);
                resolve();
            }
        });
    }

    public addInterceptor(interceptor: GGEventsInterceptor): void {
        this.interceptors.set(interceptor.getKey(), interceptor);
    }

    public deleteInterceptor(interceptor: GGEventsInterceptor): void {
        this.interceptors.delete(interceptor.getKey());
    }

    /**
     * Find an interceptor that matches the given message.
     * Interceptors are keyed by type:resourceName:eventType
     */
    private findInterceptor(type: 'sns' | 'sqs', resourceName: string, message: any): GGEventsInterceptor | undefined {
        for (const interceptor of this.interceptors.values()) {
            if (interceptor.type === type &&
                interceptor.resourceName === resourceName &&
                interceptor.matches(message)) {
                return interceptor;
            }
        }
        return undefined;
    }

    /**
     * Deliver a message to a specific queue and notify the subscriber.
     * Waits for the message to be processed before returning.
     * This makes SNS→SQS synchronous in tests for deterministic behavior.
     */
    private async deliverToQueue(sub: QueueSubscription, messageId: string, message: any): Promise<void> {
        const receiptHandle = `receipt-${messageId}-${sub.queueName}`;
        const queue = this.queues.get(sub.queueName) ?? [];
        queue.push({
            messageId,
            body: message,
            receiptHandle,
            receivedCount: 0,
            // Subtract 1ms to ensure message age is always > 0 even with instant processing
            sentTimestamp: Date.now() - 1
        });
        this.queues.set(sub.queueName, queue);

        // Track pending message for delete callback (cleanup)
        this.pendingMessages.set(receiptHandle, () => {});

        try {
            // sqsNotify awaits processAvailableMessages - processing completes when this returns
            await this.runner.ipcServer.sendFrameworkMessage(sub.runtimeId, GGEventsIPC.worker.sqsNotify, {
                serviceName: sub.serviceName
            });
        } catch (e) {
            // Worker may have disconnected
        } finally {
            // Clean up pending message tracking
            this.pendingMessages.delete(receiptHandle);
        }
    }

    public async teardown(): Promise<void> {
        this.interceptors.clear();
        this.subscriptions.length = 0;
        this.queues.clear();
        this.pendingMessages.clear();
        this.messageIdCounter = 0;
    }

    /**
     * Inject a raw message to an SNS topic (bypasses publisher validation).
     * Fans out to all subscribed queues.
     */
    public async injectToTopic(topicName: string, message: any): Promise<string> {
        const messageId = `inject-${++this.messageIdCounter}`;
        const subscribers = this.subscriptions.filter(s => s.topicName === topicName);
        for (const sub of subscribers) {
            await this.deliverToQueue(sub, messageId, message);
        }
        return messageId;
    }

    /**
     * Inject a raw message directly to an SQS queue (bypasses SNS entirely).
     */
    public async injectToQueue(queueName: string, message: any): Promise<string> {
        const messageId = `inject-${++this.messageIdCounter}`;
        const sub = this.subscriptions.find(s => s.queueName === queueName);
        if (sub) {
            await this.deliverToQueue(sub, messageId, message);
        }
        return messageId;
    }
}

GGTestRunner.registerExtension(GGEventsServer);
