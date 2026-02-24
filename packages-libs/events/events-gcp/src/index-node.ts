import {createGcpPubsubProviderConfig, GcpPubsubProviderConfig, GcpPubsubPublisherAdapter} from "./GcpPubsubPublisherAdapter"
import {createGcpPubsubSubscriberProviderConfig, GcpPubsubSubscriberAdapter} from "./GcpPubsubSubscriberAdapter"
import {EventPublisherResource, GGEventsApi} from "@grest-ts/events";
import {GGContractClass} from "@grest-ts/schema";

export {GcpPubsubPublisherAdapter, createGcpPubsubProviderConfig} from "./GcpPubsubPublisherAdapter"
export type {GcpPubsubProviderConfig} from "./GcpPubsubPublisherAdapter"
export {GcpPubsubSubscriberAdapter} from "./GcpPubsubSubscriberAdapter"

export function gcpPubsubPublisher<TContract extends GGEventsApi>(
    topicName: string,
    contract: GGContractClass<TContract>,
): EventPublisherResource<TContract, GcpPubsubProviderConfig> {
    return new EventPublisherResource<TContract, GcpPubsubProviderConfig>(
        topicName,
        () => ({
            apiName: contract.name,
            topicName: topicName,
            events: contract.methods
        }),
        {
            provider: "gcp_pubsub",
            providerConfigFactory: createGcpPubsubProviderConfig,
            adapterFactory: (config) => new GcpPubsubPublisherAdapter(config),
            subscriberProvider: "gcp_pubsub",
            subscriberAdapterFactory: (config) => new GcpPubsubSubscriberAdapter(`EventSubscriber:${config.resource.queueName}`, config),
            subscriberProviderConfigFactory: createGcpPubsubSubscriberProviderConfig,
        }
    )
}
