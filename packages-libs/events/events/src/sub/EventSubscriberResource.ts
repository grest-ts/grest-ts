import {EventSubscriberConfig, EventSubscriberConfigSettings} from "./EventSubscriberConfig"
import {EventPublisherResource} from "../pub/EventPublisherResource"
import {validateEventName} from "../GGEventsContract"
import {SubscriberTransport} from "./SubscriberTransport"

export type SubscriberProviderConfigFactory<TProviderConfig> = (queueName: string) => TProviderConfig

export interface EventSubscriberResourceSettings<TEventMap, TProviderConfig = unknown> {
    readonly messageRetentionSeconds: number
    readonly deadLetterAfterRetries: number
    readonly visibilityTimeoutDefault?: number
    readonly provider?: string
    readonly providerConfigFactory?: SubscriberProviderConfigFactory<TProviderConfig>
    readonly adapterFactory?: SubscriberAdapterFactory<TEventMap, TProviderConfig>
}

export type SubscriberAdapterFactory<TEventMap, TProviderConfig = unknown> = (config: EventSubscriberConfig<TEventMap, TProviderConfig>) => SubscriberTransport

export class EventSubscriberResource<TEventMap, TProviderConfig = unknown> {

    public readonly topic: EventPublisherResource<TEventMap, any>
    public readonly queueName: string
    public readonly resourceSettings: EventSubscriberResourceSettings<TEventMap, TProviderConfig>
    public readonly provider: string
    public readonly providerConfigFactory: SubscriberProviderConfigFactory<TProviderConfig> | undefined
    public readonly adapterFactory: SubscriberAdapterFactory<TEventMap, TProviderConfig> | undefined

    constructor(
        topic: EventPublisherResource<TEventMap, any>,
        queueName: string,
        resourceSettings: EventSubscriberResourceSettings<TEventMap, TProviderConfig>
    ) {
        validateEventName(queueName, "queue")
        this.topic = topic
        this.queueName = queueName
        this.resourceSettings = Object.freeze({...resourceSettings})
        this.provider = resourceSettings.provider ?? topic.options.provider
        this.providerConfigFactory = resourceSettings.providerConfigFactory
        this.adapterFactory = resourceSettings.adapterFactory
        Object.freeze(this)
    }

    public config(settings?: EventSubscriberConfigSettings): EventSubscriberConfig<TEventMap, TProviderConfig> {
        return new EventSubscriberConfig<TEventMap, TProviderConfig>(this, settings)
    }

    public toManifest(): EventSubscriberManifest | null {
        if (this.provider === "local") {
            return null
        }
        return {
            type: `${this.provider}_queue`,
            queueName: this.queueName,
            subscribesTo: this.topic.topicName,
            provider: this.provider,
            settings: {
                messageRetentionSeconds: this.resourceSettings.messageRetentionSeconds,
                deadLetterAfterRetries: this.resourceSettings.deadLetterAfterRetries,
                visibilityTimeoutDefault: this.resourceSettings.visibilityTimeoutDefault,
            },
        }
    }
}

export interface EventSubscriberManifest {
    readonly type: string
    readonly queueName: string
    readonly subscribesTo: string
    readonly provider: string
    readonly settings: {
        readonly messageRetentionSeconds: number
        readonly deadLetterAfterRetries: number
        readonly visibilityTimeoutDefault?: number
    }
}