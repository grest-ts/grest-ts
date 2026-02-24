import {GGLog} from "@grest-ts/logger"
import {PublisherTransport, SubscriberTransport, ReceivedMessage, EventPublisherConfig, EventSubscriberConfig, PublishResult} from "./index-node"

class LocalMessageBroker {
    private static subscribers = new Map<string, Set<(msg: any) => void>>()

    static subscribe(topic: string, handler: (msg: any) => void): void {
        let handlers = this.subscribers.get(topic)
        if (!handlers) {
            handlers = new Set()
            this.subscribers.set(topic, handlers)
        }
        handlers.add(handler)
    }

    static unsubscribe(topic: string, handler: (msg: any) => void): void {
        const handlers = this.subscribers.get(topic)
        if (handlers) {
            handlers.delete(handler)
        }
    }

    static publish(topic: string, message: any): void {
        const handlers = this.subscribers.get(topic)
        if (handlers) {
            for (const handler of handlers) {
                handler(message)
            }
        }
    }

    static clear(): void {
        this.subscribers.clear()
    }
}

export class LocalPublisherAdapter<TMessage> implements PublisherTransport<TMessage> {

    protected readonly config: EventPublisherConfig<any>
    private counter = 0

    constructor(config: EventPublisherConfig<any>) {
        this.config = config
    }

    public async start(): Promise<void> {
        GGLog.debug(this, `Started local publisher for topic: ${this.config.resource.topicName}`)
    }

    public isConfigured(): boolean {
        return true
    }

    public async publish(message: TMessage): Promise<PublishResult> {
        const id = String(++this.counter)
        const messageBody = JSON.stringify(message)

        GGLog.debug(this, `Publishing to local topic ${this.config.resource.topicName}:`, message)

        LocalMessageBroker.publish(this.config.resource.topicName, message)

        return {messageId: id, messageSize: messageBody.length}
    }

    public async publishBatch(messages: TMessage[]): Promise<void> {
        GGLog.debug(this, `Publishing batch of ${messages.length} messages to local topic ${this.config.resource.topicName}`)

        for (const msg of messages) {
            await this.publish(msg)
        }
    }

    public destroy(): void {
        // No-op for local adapter
    }
}

export class LocalSubscriberAdapter implements SubscriberTransport {

    public readonly serviceName: string
    protected readonly config: EventSubscriberConfig<any>
    private queue: ReceivedMessage[] = []
    private counter = 0
    private messageHandler: ((msg: any) => void) | null = null
    private waitingResolver: (() => void) | null = null

    constructor(serviceName: string, config: EventSubscriberConfig<any>) {
        this.serviceName = serviceName
        this.config = config
    }

    public async start(): Promise<void> {
        const topicName = this.config.resource.topic.topicName

        this.messageHandler = (message: any) => {
            this.enqueue(message)
        }

        LocalMessageBroker.subscribe(topicName, this.messageHandler)

        GGLog.debug(this, `Started local subscriber for queue: ${this.config.resource.queueName} (topic: ${topicName})`)
    }

    public isConfigured(): boolean {
        return true
    }

    private enqueue(message: any): void {
        const id = String(++this.counter)
        this.queue.push({
            messageId: id,
            receiptHandle: id,
            body: JSON.stringify(message),
            receiveCount: 1,
            sentTimestamp: Date.now(),
        })

        if (this.waitingResolver) {
            const resolver = this.waitingResolver
            this.waitingResolver = null
            resolver()
        }
    }

    public async receiveMessages(): Promise<ReceivedMessage[]> {
        const settings = this.config.settings.get()
        const maxMessages = settings.batchSize ?? 10
        const waitTimeMs = (settings.waitTimeSeconds ?? 20) * 1000

        GGLog.debug(this, `Polling local queue ${this.config.resource.queueName}`)

        if (this.queue.length === 0) {
            await Promise.race([
                new Promise<void>(resolve => {
                    this.waitingResolver = resolve
                }),
                new Promise<void>(resolve => setTimeout(resolve, waitTimeMs))
            ])
        }

        return this.queue.splice(0, maxMessages)
    }

    public async deleteMessage(receiptHandle: string): Promise<void> {
        GGLog.debug(this, `Deleted local message`, {receiptHandle})
    }

    public destroy(): void {
        if (this.messageHandler) {
            const topicName = this.config.resource.topic.topicName
            LocalMessageBroker.unsubscribe(topicName, this.messageHandler)
            this.messageHandler = null
        }
        this.queue = []
    }

    public notify(): void {
        if (this.waitingResolver) {
            const resolver = this.waitingResolver
            this.waitingResolver = null
            resolver()
        }
    }
}

export {LocalMessageBroker}
