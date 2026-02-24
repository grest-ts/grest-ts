import {GGCounterKey, GGGaugeKey, GGMetrics} from "@grest-ts/metrics";

type JobResult = 'OK' | 'ERROR' | string;

export const GGPollerMetrics = GGMetrics.define('/poller/', () => ({
    leadership: {
        isLeader: new GGGaugeKey<{ poller: string }>('is_leader', {
            help: 'Whether this instance is currently the leader (1) or not (0)',
            labelNames: ['poller'],
        }),

        totalHoldTime: new GGCounterKey<{ poller: string }>('leadership_total_hold_time_ms', {
            help: 'Total time this instance has spent as leader in milliseconds',
            labelNames: ['poller'],
        }),
    },

    polling: {
        polls: new GGCounterKey<{ poller: string }>('polls_total', {
            help: 'Total number of poll cycles executed',
            labelNames: ['poller'],
        }),

        duration: new GGCounterKey<{ poller: string }>('poll_duration_ms', {
            help: 'Total job processing duration in milliseconds',
            labelNames: ['poller'],
        }),

        emptyPolls: new GGCounterKey<{ poller: string }>('polls_empty_total', {
            help: 'Number of polls that returned no items',
            labelNames: ['poller'],
        }),
    },

    jobs: {
        processed: new GGCounterKey<{ poller: string; result: JobResult }>('jobs_total', {
            help: 'Total jobs processed',
            labelNames: ['poller', 'result'],
            groupBy: {labels: ['poller']},
        }),

        duration: new GGCounterKey<{ poller: string }>('job_duration_ms', {
            help: 'Total job processing duration in milliseconds',
            labelNames: ['poller'],
        }),

        inFlight: new GGGaugeKey<{ poller: string }>('jobs_in_flight', {
            help: 'Number of jobs currently being processed',
            labelNames: ['poller'],
        }),
    },

    duration: new GGCounterKey<{ poller: string }>('cycle_duration_ms', {
        help: 'Total processing time that it took to handle getting dataset and processing all jobs.',
        labelNames: ['poller'],
    }),

}));
