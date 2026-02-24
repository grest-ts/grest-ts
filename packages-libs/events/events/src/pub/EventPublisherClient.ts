import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator"
import {GGLog} from "@grest-ts/logger"
import {GGPromise, OK_JSON, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema"
import {GG_TRACE, TraceContext} from "@grest-ts/trace"
import {GGContextStore} from "@grest-ts/context"
import {GG_DISCOVERY} from "@grest-ts/discovery"
import {EventPublisherConfig} from "./EventPublisherConfig"
import {PublisherTransport} from "./PublisherTransport"
import {GGEventsMetrics, PublisherWarning} from "../EventsMetrics"
import {GGEventsContract} from "../GGEventsContract"
import {LocalPublisherAdapter} from "../LocalAdapter"

export type EventPayload<T> = T extends (event: infer E) => PromiseLike<void> ? E : never

export type EventMessage<TEventMap> = {
    [K in keyof TEventMap]: { type: K; data: EventPayload<TEventMap[K]>; trace: TraceContext | undefined }
}[keyof TEventMap]

export class EventPublisherClient<TEventMap> {

    public readonly config: EventPublisherConfig<TEventMap>
    public readonly token: GGLocatorKey<EventPublisherClient<TEventMap>>
    private _adapter?: PublisherTransport<EventMessage<TEventMap>>
    private readonly contract: GGEventsContract<TEventMap> | undefined
    private readonly provider: string
    private started = false
    private batch: EventMessage<TEventMap>[] = []
    private batchTimer: ReturnType<typeof setTimeout> | null = null

    constructor(config: EventPublisherConfig<TEventMap>) {
        this.config = config
        this.contract = config.resource.contract
        this.provider = config.resource.options.provider
        this.token = new GGLocatorKey<EventPublisherClient<TEventMap>>(`EventPublisher:${config.resource.topicName}`)

        GGLocator.getScope().setWithLifecycle(this.token, this, {
            type: GGLocatorServiceType.DATABASE,
            start: () => this.start(),
            teardown: () => this.teardown()
        })
    }

    /** Lazy adapter - created on first access. Can be overridden by testkit. */
    protected get adapter(): PublisherTransport<EventMessage<TEventMap>> {
        if (!this._adapter) {
            const discovery = GG_DISCOVERY.get()
            if (discovery.isLocal) {
                this._adapter = new LocalPublisherAdapter(this.config) as PublisherTransport<EventMessage<TEventMap>>
            } else {
                this._adapter = this.config.resource.options.adapterFactory(this.config) as PublisherTransport<EventMessage<TEventMap>>
            }
        }
        return this._adapter
    }

    public async start(): Promise<void> {
        await this.adapter.start()
        this.started = true
        GGLog.info(this, `Started ${this.provider} publisher for topic: ${this.config.resource.topicName}`)
    }

    public async teardown(): Promise<void> {
        await this.flushBatch()
        this.adapter.destroy()
        this.started = false
        GGLog.info(this, `Stopped ${this.provider} publisher for topic: ${this.config.resource.topicName}`)
    }

    public publish<K extends keyof TEventMap & string>(
        type: K,
        data: EventPayload<TEventMap[K]>
    ): GGPromise<void, typeof SERVER_ERROR.infer | typeof VALIDATION_ERROR.infer> {
        const validatedData = this.validateEventData(type, data)
        if (validatedData instanceof VALIDATION_ERROR) {
            return new GGPromise(Promise.resolve(validatedData))
        }

        const trace = GGContextStore.tryGetContext() ? GG_TRACE.get() : undefined
        const message = {type, data: validatedData, trace} as EventMessage<TEventMap>
        return new GGPromise(this.publishInternal(message))
    }

    private validateEventData<K extends keyof TEventMap & string>(
        type: K,
        data: EventPayload<TEventMap[K]>
    ): EventPayload<TEventMap[K]> | typeof VALIDATION_ERROR.infer {
        if (!this.contract) {
            return data
        }

        const eventContract = this.contract.events[type as keyof TEventMap]
        if (!eventContract) {
            GGLog.warn(this, `No contract found for event type "${type}", skipping validation`)
            return data
        }

        const validator = eventContract.input
        if (!validator) {
            return data
        }

        const result = validator.safeParse(data, true)

        if (result.success === false) {
            GGLog.error(this, `Event validation failed for "${type}":`, result.issues)
            return new VALIDATION_ERROR(result.issues.toJSON(), {
                displayMessage: `Invalid event data for "${type}"`
            })
        }

        return result.value as EventPayload<TEventMap[K]>
    }

    private async publishInternal(message: EventMessage<TEventMap>): Promise<OK_JSON<void> | typeof SERVER_ERROR.infer> {
        if (!this.adapter.isConfigured()) {
            GGLog.debug(this, `${this.provider} adapter not configured, skipping publish to ${this.config.resource.topicName}:`, message)
            return {success: true, type: "OK", data: undefined}
        }

        const settings = this.config.settings.get()
        if (settings.batching) {
            await this.publishBatched(message)
        } else {
            const result = await this.publishImmediate(message)
            if (!result.success) {
                return result
            }
        }
        return {success: true, type: "OK", data: undefined}
    }

    private async publishImmediate(message: EventMessage<TEventMap>): Promise<OK_JSON<void> | typeof SERVER_ERROR.infer> {
        const topic = this.config.resource.topicName
        const eventType = String(message.type)
        const startTime = Date.now()

        const settings = this.config.settings.get()
        const retryAttempts = settings.retryAttempts ?? 3

        for (let attempt = 1; attempt <= retryAttempts; attempt++) {
            try {
                const {messageSize} = await this.adapter.publish(message)
                const duration = Date.now() - startTime

                GGEventsMetrics.publisher.messageSizeSum.inc(messageSize, {topic, provider: this.provider})
                GGEventsMetrics.publisher.published.inc(1, {topic, provider: this.provider, eventType, result: 'OK'})
                GGEventsMetrics.publisher.publishDurationSum.inc(duration, {topic, provider: this.provider})

                const maxSize = 256 * 1024
                if (messageSize > maxSize * settings.messageSizeWarningRatio) {
                    GGEventsMetrics.publisher.warnings.inc(1, {topic, provider: this.provider, reason: PublisherWarning.MESSAGE_SIZE_NEAR_LIMIT})
                    GGLog.warn(this, `Message size ${messageSize} bytes exceeds ${settings.messageSizeWarningRatio * 100}% of max (${maxSize} bytes)`)
                }

                if (duration > settings.publishSlowThresholdMs) {
                    GGEventsMetrics.publisher.warnings.inc(1, {topic, provider: this.provider, reason: PublisherWarning.PUBLISH_SLOW})
                    GGLog.warn(this, `Publish took ${duration}ms, exceeds threshold of ${settings.publishSlowThresholdMs}ms`)
                }

                return {success: true, type: "OK", data: undefined}
            } catch (error) {
                if (attempt === retryAttempts) {
                    GGLog.error(this, `Failed to publish message after ${retryAttempts} attempts:`, error)
                    GGEventsMetrics.publisher.published.inc(1, {topic, provider: this.provider, eventType, result: 'ERROR'})
                    GGEventsMetrics.publisher.publishDurationSum.inc(Date.now() - startTime, {topic, provider: this.provider})
                    return new SERVER_ERROR({
                        debugMessage: `Failed to publish message!`,
                        debugData: {retryAttempts, message},
                        originalError: error
                    })
                }
                GGLog.warn(this, `Publish attempt ${attempt} failed, retrying...`)
                await new Promise(resolve => setTimeout(resolve, 100 * attempt))
            }
        }
        return {success: true, type: "OK", data: undefined}
    }

    private async publishBatched(message: EventMessage<TEventMap>): Promise<void> {
        this.batch.push(message)

        const settings = this.config.settings.get()
        if (!this.batchTimer && settings.batching) {
            this.batchTimer = setTimeout(() => this.flushBatch(), settings.batching.waitMs)
        }

        if (settings.batching && this.batch.length >= settings.batching.size) {
            await this.flushBatch()
        }
    }

    public async flushBatch(): Promise<void> {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer)
            this.batchTimer = null
        }

        if (this.batch.length === 0) {
            return
        }

        const messagesToSend = this.batch
        this.batch = []

        if (!this.adapter.isConfigured()) {
            GGLog.debug(this, `${this.provider} adapter not configured, skipping batch flush of ${messagesToSend.length} messages`)
            return
        }

        try {
            await this.adapter.publishBatch(messagesToSend)
        } catch (error) {
            GGLog.error(this, `Failed to send batch of ${messagesToSend.length} messages:`, error)
            throw error
        }
    }

    public isStarted(): boolean {
        return this.started
    }
}
