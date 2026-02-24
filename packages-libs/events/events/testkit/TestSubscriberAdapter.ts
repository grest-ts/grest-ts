import {EventSubscriberClient, ReceivedMessage, SubscriberTransport} from "../src/index-node";
import {GG_TEST_RUNTIME_WORKER} from "@grest-ts/testkit";
import {GGEventsIPC} from "./GGEventsCommands";

export class TestSubscriberAdapter implements SubscriberTransport {
    private _notifyResolver?: () => void

    constructor(
        public readonly serviceName: string,
        private readonly config: any
    ) {
    }

    async start(): Promise<void> {
        const worker = GG_TEST_RUNTIME_WORKER.get()
        await worker.ipcClient.sendFrameworkRequest(GGEventsIPC.test.sqsRegister, {
            serviceName: this.serviceName,
            topicName: this.config.resource.topic.topicName,
            queueName: this.config.resource.queueName,
            runtimeId: worker.config.runtimeId
        })
    }

    isConfigured(): boolean {
        return true
    }

    notify(): void {
        if (this._notifyResolver) {
            const resolver = this._notifyResolver
            this._notifyResolver = undefined
            resolver()
        }
    }

    async receiveMessages(): Promise<ReceivedMessage[]> {
        const worker = GG_TEST_RUNTIME_WORKER.get()
        const settings = this.config.settings.get()

        const payload = {
            queueName: this.config.resource.queueName,
            maxMessages: settings.batchSize ?? 10
        }

        const result = await worker.ipcClient.sendFrameworkRequest(GGEventsIPC.test.sqsPoll, payload)

        if (result.messages.length > 0) {
            return result.messages.map((m: any) => ({
                messageId: m.messageId,
                receiptHandle: m.receiptHandle,
                body: JSON.stringify(m.body),
                receiveCount: 1,
                sentTimestamp: m.sentTimestamp
            }))
        }

        // Wait for notification or timeout
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                this._notifyResolver = undefined
                resolve()
            }, 100)

            this._notifyResolver = () => {
                clearTimeout(timer)
                resolve()
            }
        })

        // Retry after wait
        const retryResult = await worker.ipcClient.sendFrameworkRequest(GGEventsIPC.test.sqsPoll, payload)

        return retryResult.messages.map((m: any) => ({
            messageId: m.messageId,
            receiptHandle: m.receiptHandle,
            body: JSON.stringify(m.body),
            receiveCount: 1,
            sentTimestamp: m.sentTimestamp
        }))
    }

    async deleteMessage(receiptHandle: string): Promise<void> {
        const worker = GG_TEST_RUNTIME_WORKER.get()
        await worker.ipcClient.sendFrameworkRequest(GGEventsIPC.test.sqsDelete, {
            queueName: this.config.resource.queueName,
            receiptHandle
        })
    }

    destroy(): void {
        // No-op in tests
    }
}

const TEST_ADAPTER = Symbol('testAdapter')

Object.defineProperty(EventSubscriberClient.prototype, 'adapter', {
    get(this: any) {
        if (!this[TEST_ADAPTER]) {
            this[TEST_ADAPTER] = new TestSubscriberAdapter(this.name, this.config)
        }
        return this[TEST_ADAPTER]
    },
    configurable: true
})
