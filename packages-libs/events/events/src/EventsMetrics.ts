import {GGCounterKey, GGGaugeKey, GGMetrics} from "@grest-ts/metrics"
import {enumOf, type Values} from "@grest-ts/common"

type PublishResult = 'OK' | 'ERROR' | string
type ProcessResult = 'OK' | 'ERROR' | 'SKIPPED' | string

export const PublisherWarning = enumOf({
    MESSAGE_SIZE_NEAR_LIMIT: 'message_size_near_limit',
    PUBLISH_SLOW: 'publish_slow',
})
export type PublisherWarning = Values<typeof PublisherWarning>

export const SubscriberWarning = enumOf({
    MESSAGE_AGE_HIGH: 'message_age_high',
    PROCESSING_SLOW: 'processing_slow',
    HIGH_REDELIVERY_COUNT: 'high_redelivery_count',
})
export type SubscriberWarning = Values<typeof SubscriberWarning>

export const GGEventsMetrics = GGMetrics.define('/events/', () => ({

    publisher: {
        published: new GGCounterKey<{ topic: string, provider: string, eventType: string, result: PublishResult }>('events_published_total', {
            help: 'Total messages published',
            labelNames: ['topic', 'provider', 'eventType', 'result'],
            groupBy: {labels: ["topic", "eventType"], template: "{topic}.{eventType}"}
        }),

        publishDurationSum: new GGCounterKey<{ topic: string, provider: string }>('events_publish_duration_ms_sum', {
            help: 'Sum of publish durations in milliseconds',
            labelNames: ['topic', 'provider'],
        }),

        messageSizeSum: new GGCounterKey<{ topic: string, provider: string }>('events_message_size_bytes_sum', {
            help: 'Sum of message sizes in bytes',
            labelNames: ['topic', 'provider'],
        }),

        warnings: new GGCounterKey<{ topic: string, provider: string, reason: PublisherWarning }>('events_publisher_warnings_total', {
            help: 'Warning conditions detected in publishing',
            labelNames: ['topic', 'provider', 'reason'],
        }),
    },

    subscriber: {
        processed: new GGCounterKey<{ queue: string, provider: string, eventType: string, result: ProcessResult }>('events_processed_total', {
            help: 'Total messages processed',
            labelNames: ['queue', 'provider', 'eventType', 'result'],
            groupBy: {labels: ["queue", "eventType"], template: "{queue}.{eventType}"}
        }),

        processingDurationSum: new GGCounterKey<{ queue: string, provider: string }>('events_processing_duration_ms_sum', {
            help: 'Sum of handler processing durations in milliseconds',
            labelNames: ['queue', 'provider'],
        }),

        messageAgeSum: new GGCounterKey<{ queue: string, provider: string }>('events_message_age_ms_sum', {
            help: 'Sum of message ages (time from root request to processing)',
            labelNames: ['queue', 'provider'],
        }),

        inFlight: new GGGaugeKey<{ queue: string, provider: string }>('events_in_flight', {
            help: 'Messages currently being processed',
            labelNames: ['queue', 'provider'],
        }),

        redeliveries: new GGCounterKey<{ queue: string, provider: string }>('events_redeliveries_total', {
            help: 'Messages received more than once (potential processing issues)',
            labelNames: ['queue', 'provider'],
        }),

        warnings: new GGCounterKey<{ queue: string, provider: string, reason: SubscriberWarning }>('events_subscriber_warnings_total', {
            help: 'Warning conditions detected in processing',
            labelNames: ['queue', 'provider', 'reason'],
        }),
    },

}))
