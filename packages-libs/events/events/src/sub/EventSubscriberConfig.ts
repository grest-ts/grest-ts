import {GGSetting} from "@grest-ts/config"
import {EventSubscriberResource} from "./EventSubscriberResource"
import {EventSubscriberClient} from "./EventSubscriberClient"
import {EventMessage, EventPayload} from "../pub/EventPublisherClient"
import {IsNumber, IsObject} from "@grest-ts/schema"

export interface EventSubscriberConfigSettings {
    readonly batchSize?: number
    readonly visibilityTimeout?: number
    readonly waitTimeSeconds?: number
    readonly concurrency?: number
    readonly messageAgeWarningMs?: number
    readonly processingSlowThresholdMs?: number
    readonly highRedeliveryThreshold?: number
}

const IsEventSubscriberConfigSettings = IsObject({
    batchSize: IsNumber.orUndefined,
    visibilityTimeout: IsNumber.orUndefined,
    waitTimeSeconds: IsNumber.orUndefined,
    concurrency: IsNumber.orUndefined,
    messageAgeWarningMs: IsNumber.orUndefined,
    processingSlowThresholdMs: IsNumber.orUndefined,
    highRedeliveryThreshold: IsNumber.orUndefined
})

export interface MessageHandlerContext {
    readonly messageId: string
    readonly receiptHandle: string
    readonly receiveCount: number
    readonly sentTimestamp: number
}

export type EventHandlers<TEventMap> = {
    [K in keyof TEventMap]?: (
        event: EventPayload<TEventMap[K]>,
        context?: MessageHandlerContext
    ) => Promise<void>
}

export type MessageHandler<TEventMap> =
    (message: EventMessage<TEventMap>, context: MessageHandlerContext) => Promise<boolean>

export class EventSubscriberConfig<TEventMap, TProviderConfig = unknown> {

    public readonly resource: EventSubscriberResource<TEventMap, TProviderConfig>
    public readonly settings: GGSetting<EventSubscriberConfigSettings>
    public readonly providerConfig: TProviderConfig

    constructor(resource: EventSubscriberResource<TEventMap, TProviderConfig>, data?: EventSubscriberConfigSettings) {
        this.resource = resource
        const provider = resource.provider

        this.settings = new GGSetting(`events/${provider}/${resource.queueName}/settings`, IsEventSubscriberConfigSettings, {
            batchSize: data?.batchSize ?? 20,
            visibilityTimeout: data?.visibilityTimeout ?? resource.resourceSettings.visibilityTimeoutDefault ?? 30,
            waitTimeSeconds: data?.waitTimeSeconds ?? 20,
            concurrency: data?.concurrency ?? 1,
            messageAgeWarningMs: data?.messageAgeWarningMs ?? 30000,
            processingSlowThresholdMs: data?.processingSlowThresholdMs ?? 5000,
            highRedeliveryThreshold: data?.highRedeliveryThreshold ?? 3,
        }, "Event subscriber settings")
        this.providerConfig = resource.providerConfigFactory?.(resource.queueName) as TProviderConfig
        Object.freeze(this)
    }

    public newSubscriber(handlers: EventHandlers<TEventMap>): EventSubscriberClient<TEventMap> {
        const wrappedHandler: MessageHandler<TEventMap> = async (message, context) => {
            const handler = (handlers as any)[message.type]
            if (handler) {
                await handler(message.data, context)
                return true
            }
            return true
        }
        return new EventSubscriberClient<TEventMap>(this, wrappedHandler)
    }
}
