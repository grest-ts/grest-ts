import "./_dedupCheck";
import {EventPublisherResource, GGEventApi, GGEventsApi} from "@grest-ts/events"
import {GGContractClass} from "@grest-ts/schema"
import {AwsSnsAdapter, AwsSnsProviderConfig, createAwsSnsProviderConfig} from "./AwsSnsAdapter"
import {AwsSqsAdapter, createAwsSqsProviderConfig} from "./AwsSqsAdapter"

export {AwsSnsAdapter, createAwsSnsProviderConfig} from "./AwsSnsAdapter"
export type {AwsSnsProviderConfig} from "./AwsSnsAdapter"
export {AwsSqsAdapter} from "./AwsSqsAdapter"

export function awsSnsPublisher<TContract extends GGEventsApi>(
    contract: GGContractClass<TContract>,
    topicName: string
): EventPublisherResource<GGEventApi<TContract>, AwsSnsProviderConfig> {
    return new EventPublisherResource<GGEventApi<TContract>, AwsSnsProviderConfig>(
        topicName,
        () => ({
            apiName: contract.name,
            topicName: topicName,
            events: contract.methods
        }),
        {
            provider: "aws_sns",
            providerConfigFactory: createAwsSnsProviderConfig,
            adapterFactory: (config) => new AwsSnsAdapter(config),
            subscriberProvider: "aws_sqs",
            subscriberAdapterFactory: (config) => new AwsSqsAdapter(`EventSubscriber:${config.resource.queueName}`, config),
            subscriberProviderConfigFactory: createAwsSqsProviderConfig,
        }
    )
}
