import {GGSetting} from "@grest-ts/config"
import {EventPublisherResource} from "./EventPublisherResource"
import {EventPublisherClient} from "./EventPublisherClient"
import {IsNumber, IsObject} from "@grest-ts/schema"

export interface EventPublisherConfigSettings {
    readonly retryAttempts?: number
    readonly timeout?: number
    readonly batching?: EventPublisherBatchSettings
    readonly messageSizeWarningRatio?: number
    readonly publishSlowThresholdMs?: number
}

export interface EventPublisherBatchSettings {
    readonly size: number
    readonly waitMs: number
}

const IsEventPublisherBatchSettings = IsObject({
    size: IsNumber,
    waitMs: IsNumber
})

const IsEventPublisherConfigSettings = IsObject({
    retryAttempts: IsNumber.orUndefined,
    timeout: IsNumber.orUndefined,
    batching: IsEventPublisherBatchSettings.orUndefined,
    messageSizeWarningRatio: IsNumber.orUndefined,
    publishSlowThresholdMs: IsNumber.orUndefined
})

export class EventPublisherConfig<TEventMap, TProviderConfig = unknown> {

    public readonly resource: EventPublisherResource<TEventMap, TProviderConfig>
    public readonly settings: GGSetting<EventPublisherConfigSettings>
    public readonly providerConfig: TProviderConfig

    constructor(resource: EventPublisherResource<TEventMap, TProviderConfig>, data?: EventPublisherConfigSettings) {
        this.resource = resource
        const provider = resource.options.provider

        this.settings = new GGSetting(`events/${provider}/${resource.topicName}/settings`, IsEventPublisherConfigSettings, {
            retryAttempts: data?.retryAttempts ?? 3,
            timeout: data?.timeout ?? 5000,
            batching: data?.batching,
            messageSizeWarningRatio: data?.messageSizeWarningRatio ?? 0.8,
            publishSlowThresholdMs: data?.publishSlowThresholdMs ?? 500,
        }, "Event publisher settings")

        this.providerConfig = resource.options.providerConfigFactory?.(resource.topicName) as TProviderConfig
        Object.freeze(this)
    }

    public newPublisher(): EventPublisherClient<TEventMap> {
        return new EventPublisherClient<TEventMap>(this)
    }
}
