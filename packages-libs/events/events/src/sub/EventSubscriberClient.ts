import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {sleep} from "@grest-ts/common"
import {GGContext} from "@grest-ts/context"
import {GG_TRACE} from "@grest-ts/trace"
import {GG_ASYNC_EVENT} from "../GGAsyncEventKey"
import {GG_DISCOVERY} from "@grest-ts/discovery"
import {EventSubscriberConfig, MessageHandler} from "./EventSubscriberConfig"
import {ReceivedMessage, SubscriberTransport} from "./SubscriberTransport"
import {EventMessage} from "../pub/EventPublisherClient"
import {GGEventsContract} from "../GGEventsContract"
import {GGEventsMetrics, SubscriberWarning} from "../EventsMetrics"
import {LocalSubscriberAdapter} from "../LocalAdapter"

export class EventSubscriberClient<TEventMap> {

    public readonly name: string
    public readonly token: GGLocatorKey<EventSubscriberClient<TEventMap>>
    public readonly config: EventSubscriberConfig<TEventMap>
    public readonly handler: MessageHandler<TEventMap>
    private _adapter?: SubscriberTransport
    private readonly contract: GGEventsContract<TEventMap> | undefined
    private readonly provider: string
    private running: boolean = false
    private started: boolean = false
    private pollPromise: Promise<void> | null = null

    constructor(config: EventSubscriberConfig<TEventMap>, handler: MessageHandler<TEventMap>) {
        this.name = "EventSubscriber:" + config.resource.queueName
        this.token = new GGLocatorKey<EventSubscriberClient<TEventMap>>(this.name)
        this.config = config
        this.handler = handler
        this.provider = config.resource.provider
        this.contract = config.resource.topic.contract

        GGLocator.getScope().setWithLifecycle(this.token, this, {
            type: GGLocatorServiceType.DATABASE,
            start: () => this.start(),
            teardown: () => this.teardown()
        })
    }

    /** Lazy adapter - created on first access. Can be overridden by testkit. */
    protected get adapter(): SubscriberTransport {
        if (!this._adapter) {
            const discovery = GG_DISCOVERY.get()
            if (discovery.isLocal) {
                this._adapter = new LocalSubscriberAdapter(this.name, this.config)
            } else {
                const adapterFactory = this.config.resource.adapterFactory ?? this.config.resource.topic.options.subscriberAdapterFactory
                if (!adapterFactory) {
                    throw new Error(`No adapter factory configured for subscriber ${this.config.resource.queueName}`)
                }
                this._adapter = (adapterFactory as any)(this.config)
            }
        }
        return this._adapter
    }

    public async start(): Promise<void> {
        await this.adapter.start()
        this.started = true

        if (this.adapter.isConfigured()) {
            this.startPolling()
            GGLog.info(this, `Started ${this.provider} subscriber for queue: ${this.config.resource.queueName}`)
        } else {
            GGLog.info(this, `${this.provider} subscriber not configured, skipping: ${this.config.resource.queueName}`)
        }
    }

    public async teardown(): Promise<void> {
        await this.stop()
        this.adapter.destroy()
        this.started = false
        GGLog.info(this, `Stopped ${this.provider} subscriber for queue: ${this.config.resource.queueName}`)
    }

    private startPolling(): void {
        if (this.running) {
            return
        }
        this.running = true
        this.pollPromise = this.pollLoop()
    }

    public async stop(): Promise<void> {
        this.running = false
        if (this.pollPromise) {
            await this.pollPromise
        }
    }

    public isRunning(): boolean {
        return this.running
    }

    public isStarted(): boolean {
        return this.started
    }

    public async processAvailableMessages(): Promise<void> {
        await this.pollOnce()
    }

    private async pollLoop(): Promise<void> {
        while (this.running) {
            try {
                await this.pollOnce()
            } catch (error) {
                GGLog.error(this, `Error polling ${this.provider} queue ${this.config.resource.queueName}:`, error)
                await sleep(1000)
            }
        }
    }

    private async pollOnce(): Promise<void> {
        const messages = await this.adapter.receiveMessages()

        if (messages.length === 0) {
            return
        }

        const settings = this.config.settings.get()
        const concurrency = settings.concurrency ?? 1
        const chunks = this.chunkArray(messages, concurrency)

        for (const chunk of chunks) {
            await Promise.all(chunk.map(msg => this.processMessage(msg)))
        }
    }

    private async processMessage(receivedMessage: ReceivedMessage): Promise<void> {
        const queue = this.config.resource.queueName
        const startTime = Date.now()
        const settings = this.config.settings.get()

        const mData = {queue, provider: this.provider}
        const messageAge = Date.now() - receivedMessage.sentTimestamp
        GGEventsMetrics.subscriber.inFlight.inc(1, mData)
        GGEventsMetrics.subscriber.messageAgeSum.inc(messageAge, mData)

        if (messageAge > settings.messageAgeWarningMs) {
            GGEventsMetrics.subscriber.warnings.inc(1, {queue, provider: this.provider, reason: SubscriberWarning.MESSAGE_AGE_HIGH})
            GGLog.warn(this, `Message age ${messageAge}ms exceeds threshold of ${settings.messageAgeWarningMs}ms`)
        }

        if (receivedMessage.receiveCount > 1) {
            GGEventsMetrics.subscriber.redeliveries.inc(1, mData)
        }
        if (receivedMessage.receiveCount >= settings.highRedeliveryThreshold) {
            GGEventsMetrics.subscriber.warnings.inc(1, {queue, provider: this.provider, reason: SubscriberWarning.HIGH_REDELIVERY_COUNT})
            GGLog.warn(this, `Message receive count ${receivedMessage.receiveCount} meets/exceeds threshold of ${settings.highRedeliveryThreshold}`)
        }

        const finalize = (eventType: string | "unknown", result: 'ERROR' | "OK" | "SKIPPED") => {
            const processingDuration = Date.now() - startTime
            GGEventsMetrics.subscriber.processed.inc(1, {queue, provider: this.provider, eventType, result})
            GGEventsMetrics.subscriber.inFlight.dec(1, mData)
            GGEventsMetrics.subscriber.processingDurationSum.inc(processingDuration, mData)

            if (processingDuration > settings.processingSlowThresholdMs) {
                GGEventsMetrics.subscriber.warnings.inc(1, {queue, provider: this.provider, reason: SubscriberWarning.PROCESSING_SLOW})
                GGLog.warn(this, `Processing took ${processingDuration}ms, exceeds threshold of ${settings.processingSlowThresholdMs}ms`)
            }
        }

        let message: EventMessage<TEventMap> = undefined as any
        try {
            message = JSON.parse(receivedMessage.body) as EventMessage<TEventMap>
        } catch (error) {
            GGLog.error(this, `Error processing message ${receivedMessage.messageId}:`, error)
            return void finalize('unknown', "ERROR")
        }

        const validatedMessage = this.validateMessage(message)
        if (!validatedMessage) {
            GGLog.error(this, `Validation failed for message ${receivedMessage.messageId}, leaving in queue for retry`)
            return void finalize(String(message.type), "ERROR")
        }

        try {
            const context = new GGContext("EVT");
            const success = await context.run(async () => {
                // Restore trace context from message if present
                if (validatedMessage.trace) {
                    GG_TRACE.set(validatedMessage.trace);
                } else {
                    GG_TRACE.init();
                }
                GG_ASYNC_EVENT.set({
                    eventType: String(validatedMessage.type),
                    source: `events:${queue}`
                });
                return this.handler(validatedMessage, receivedMessage);
            });
            if (success) {
                await this.adapter.deleteMessage(receivedMessage.receiptHandle)
            }
            finalize(String(validatedMessage.type), success ? 'OK' : 'SKIPPED')
        } catch (error) {
            GGLog.error(this, `Error processing message ${receivedMessage.messageId}:`, error)
            finalize(String(validatedMessage.type), "ERROR")
        }
    }

    private validateMessage(message: EventMessage<TEventMap>): EventMessage<TEventMap> | null {
        if (!this.contract) {
            return message
        }

        const eventType = message.type as keyof TEventMap
        const eventContract = this.contract.events[eventType]
        if (!eventContract) {
            GGLog.warn(this, `No contract found for event type "${String(eventType)}", skipping validation`)
            return message
        }

        const validator = eventContract.input
        if (!validator) {
            return message
        }

        const result = validator.safeParse(message.data, true)

        if (result.success === false) {
            GGLog.error(this, `Event validation failed for "${String(eventType)}":`, result.issues)
            return null
        }

        return {...message, data: result.value} as EventMessage<TEventMap>
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = []
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size))
        }
        return chunks
    }
}
