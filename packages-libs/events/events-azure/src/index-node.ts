import "./_dedupCheck";
import {EventPublisherResource, GGEventsApi} from "@grest-ts/events"
import {AzureServiceBusProviderConfig, AzureServiceBusPublisherAdapter, createAzureServiceBusProviderConfig} from "./AzureServiceBusPublisherAdapter"
import {AzureServiceBusSubscriberAdapter, createAzureServiceBusSubscriberProviderConfig} from "./AzureServiceBusSubscriberAdapter"
import {GGContractClass} from "@grest-ts/schema";

export {AzureServiceBusPublisherAdapter, createAzureServiceBusProviderConfig} from "./AzureServiceBusPublisherAdapter"
export type {AzureServiceBusProviderConfig} from "./AzureServiceBusPublisherAdapter"
export {AzureServiceBusSubscriberAdapter} from "./AzureServiceBusSubscriberAdapter"

export function azureServiceBusPublisher<TContract extends GGEventsApi>(
    topicName: string,
    contract: GGContractClass<TContract>,
): EventPublisherResource<TContract, AzureServiceBusProviderConfig> {
    return new EventPublisherResource<TContract, AzureServiceBusProviderConfig>(
        topicName,
        () => ({
            apiName: contract.name,
            topicName: topicName,
            events: contract.methods
        }),
        {
            provider: "azure_servicebus",
            providerConfigFactory: createAzureServiceBusProviderConfig,
            adapterFactory: (config) => new AzureServiceBusPublisherAdapter(config),
            subscriberProvider: "azure_servicebus",
            subscriberAdapterFactory: (config) => new AzureServiceBusSubscriberAdapter(`EventSubscriber:${config.resource.queueName}`, config),
            subscriberProviderConfigFactory: createAzureServiceBusSubscriberProviderConfig,
        }
    )
}
