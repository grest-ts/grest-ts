import {GGEventsContract, validateEventName} from "../GGEventsContract"
import {EventPublisherConfig, EventPublisherConfigSettings} from "./EventPublisherConfig"
import {EventSubscriberResource, EventSubscriberResourceSettings, SubscriberAdapterFactory} from "../sub/EventSubscriberResource"
import {PublisherTransport} from "./PublisherTransport"

export type ProviderConfigFactory<TProviderConfig> = (topicName: string) => TProviderConfig

export interface PublisherResourceOptions<TEventMap, TProviderConfig = unknown> {
    readonly provider: string
    readonly adapterFactory: PublisherAdapterFactory<TEventMap, TProviderConfig>
    readonly providerConfigFactory?: ProviderConfigFactory<TProviderConfig>
    readonly cloudSettings?: Record<string, any>
    readonly subscriberProvider?: string
    readonly subscriberAdapterFactory?: SubscriberAdapterFactory<TEventMap, any>
    readonly subscriberProviderConfigFactory?: ProviderConfigFactory<any>
}

export type PublisherAdapterFactory<TEventMap, TProviderConfig = unknown> = (config: EventPublisherConfig<TEventMap, TProviderConfig>) => PublisherTransport<any>

export class EventPublisherResource<TEventMap, TProviderConfig = unknown> {

    public readonly topicName: string
    public readonly contract: GGEventsContract<TEventMap> | undefined
    public readonly options: PublisherResourceOptions<TEventMap, TProviderConfig>

    constructor(
        topicName: string,
        contractFactory: () => GGEventsContract<TEventMap> | undefined,
        options: PublisherResourceOptions<TEventMap, TProviderConfig>
    ) {
        validateEventName(topicName, "topic")
        this.topicName = topicName
        this.contract = contractFactory?.()
        this.options = options
        Object.freeze(this)
    }

    public config(settings?: EventPublisherConfigSettings): EventPublisherConfig<TEventMap, TProviderConfig> {
        return new EventPublisherConfig<TEventMap, TProviderConfig>(this, settings)
    }

    public subscriber(queueName: string, resourceSettings: EventSubscriberResourceSettings<TEventMap>): EventSubscriberResource<TEventMap> {
        const subscriberSettings: EventSubscriberResourceSettings<TEventMap> = {
            ...resourceSettings,
            provider: resourceSettings.provider ?? this.options.subscriberProvider ?? this.options.provider,
            adapterFactory: resourceSettings.adapterFactory ?? this.options.subscriberAdapterFactory,
            providerConfigFactory: resourceSettings.providerConfigFactory ?? this.options.subscriberProviderConfigFactory,
        }
        return new EventSubscriberResource<TEventMap>(this, queueName, subscriberSettings)
    }

    public toManifest(): EventPublisherManifest | null {
        if (this.options.provider === "local") {
            return null
        }
        return {
            type: `${this.options.provider}_topic`,
            topicName: this.topicName,
            provider: this.options.provider,
            cloudSettings: this.options.cloudSettings,
        }
    }
}

export interface EventPublisherManifest {
    readonly type: string
    readonly topicName: string
    readonly provider: string
    readonly cloudSettings?: Record<string, any>
}

