import {EventSubscriberResource} from "../src/sub/EventSubscriberResource"
import {EventPayload} from "../src/pub/EventPublisherClient"
import {GGEventsInterceptor} from "./GGEventsInterceptor"
import {GG_TEST_RUNNER, GGMockWith, GGSpyWith} from "@grest-ts/testkit"
import {GGEventsServer} from "./GGEventsServer"

export type SubscriberEventsSpy<TEventMap> = {
    [K in keyof TEventMap]: GGSpyWith<EventPayload<TEventMap[K]>>
}

export type SubscriberEventsMock<TEventMap> = {
    [K in keyof TEventMap]: GGMockWith<EventPayload<TEventMap[K]>>
}

export type SubscriberEventsInject<TEventMap> = {
    [K in keyof TEventMap]: (data: any) => Promise<string>
}

declare module "../src/sub/EventSubscriberResource" {
    interface EventSubscriberResource<TEventMap, TProviderConfig> {
        readonly mock: SubscriberEventsMock<TEventMap>
        readonly spy: SubscriberEventsSpy<TEventMap>
        readonly inject: SubscriberEventsInject<TEventMap>
    }
}

Object.defineProperty(EventSubscriberResource.prototype, 'mock', {
    get<TEventMap>(this: EventSubscriberResource<TEventMap>): SubscriberEventsMock<TEventMap> {
        const queueName = this.queueName
        return new Proxy({} as SubscriberEventsMock<TEventMap>, {
            get(_target, prop) {
                if (typeof prop === 'string') {
                    return new GGMockWith(GGEventsInterceptor, {
                        type: 'sqs',
                        resourceName: queueName,
                        eventType: prop,
                        requiresWaitFor: true
                    })
                }
                return undefined
            }
        })
    },
    enumerable: false,
    configurable: true
})

Object.defineProperty(EventSubscriberResource.prototype, 'spy', {
    get<TEventMap>(this: EventSubscriberResource<TEventMap>): SubscriberEventsSpy<TEventMap> {
        const queueName = this.queueName
        return new Proxy({} as SubscriberEventsSpy<TEventMap>, {
            get(_target, prop) {
                if (typeof prop === 'string') {
                    return new GGSpyWith(GGEventsInterceptor, {
                        type: 'sqs',
                        resourceName: queueName,
                        eventType: prop,
                        requiresWaitFor: true
                    })
                }
                return undefined
            }
        })
    },
    enumerable: false,
    configurable: true
})

Object.defineProperty(EventSubscriberResource.prototype, 'inject', {
    get<TEventMap>(this: EventSubscriberResource<TEventMap>): SubscriberEventsInject<TEventMap> {
        const queueName = this.queueName
        return new Proxy({} as SubscriberEventsInject<TEventMap>, {
            get(_target, prop) {
                if (typeof prop === 'string') {
                    return async (data: any): Promise<string> => {
                        const server = GG_TEST_RUNNER.get().getExtensionInstance(GGEventsServer)
                        return server.injectToQueue(queueName, {type: prop, data})
                    }
                }
                return undefined
            }
        })
    },
    enumerable: false,
    configurable: true
})
