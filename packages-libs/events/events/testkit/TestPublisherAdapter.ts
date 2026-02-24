/**
 * Override client adapter getters to use test implementations.
 * This works for ANY adapter - built-in or custom - because we intercept at the client level.
 */
import {EventPublisherClient, PublisherTransport, PublishResult} from "../src/index-node";
import {GG_TEST_RUNTIME_WORKER} from "@grest-ts/testkit";
import {GGEventsIPC} from "./GGEventsCommands";

// =============================================================================
// TEST PUBLISHER ADAPTER
// =============================================================================

export class TestPublisherAdapter implements PublisherTransport<any> {
    constructor(private readonly config: any) {
    }

    async start(): Promise<void> {
        // No-op in tests
    }

    isConfigured(): boolean {
        return true
    }

    async publish(message: any): Promise<PublishResult> {
        const messageBody = JSON.stringify(message)
        const worker = GG_TEST_RUNTIME_WORKER.get()
        const result = await worker.ipcClient.sendFrameworkRequest(GGEventsIPC.test.snsPublish, {
            topicName: this.config.resource.topicName,
            message
        })
        if (result.success === false) {
            throw new Error("Publish failed (mock returned error)")
        }
        return {messageId: result.messageId, messageSize: messageBody.length}
    }

    async publishBatch(messages: any[]): Promise<void> {
        for (const message of messages) {
            await this.publish(message)
        }
    }

    destroy(): void {
        // No-op in tests
    }
}

const TEST_ADAPTER = Symbol('testAdapter')

Object.defineProperty(EventPublisherClient.prototype, 'adapter', {
    get(this: any) {
        if (!this[TEST_ADAPTER]) {
            this[TEST_ADAPTER] = new TestPublisherAdapter(this.config)
        }
        return this[TEST_ADAPTER]
    },
    configurable: true
})