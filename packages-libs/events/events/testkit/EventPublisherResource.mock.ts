import {EventPublisherResource} from "../src/pub/EventPublisherResource"
import {EventPayload} from "../src/pub/EventPublisherClient"
import {GGEventsInterceptor} from "./GGEventsInterceptor"
import {GG_TEST_RUNNER, GGMockWith, GGSpyWith} from "@grest-ts/testkit"
import {GGEventsServer} from "./GGEventsServer"

export type PublisherEventsSpy<TEventMap> = {
    [K in keyof TEventMap]: GGSpyWith<EventPayload<TEventMap[K]>>
}

export type PublisherEventsMock<TEventMap> = {
    [K in keyof TEventMap]: GGMockWith<EventPayload<TEventMap[K]>>
}

export type PublisherEventsInject<TEventMap> = {
    [K in keyof TEventMap]: (data: any) => Promise<string>
}

declare module "../src/pub/EventPublisherResource" {
    interface EventPublisherResource<TEventMap, TProviderConfig> {
        readonly mock: PublisherEventsMock<TEventMap>
        readonly spy: PublisherEventsSpy<TEventMap>
        readonly inject: PublisherEventsInject<TEventMap>
    }
}

Object.defineProperty(EventPublisherResource.prototype, 'mock', {
    get<TEventMap>(this: EventPublisherResource<TEventMap>): PublisherEventsMock<TEventMap> {
        const topicName = this.topicName
        return new Proxy({} as PublisherEventsMock<TEventMap>, {
            get(_target, prop) {
                if (typeof prop === 'string') {
                    return new GGMockWith(GGEventsInterceptor, {
                        type: 'sns',
                        resourceName: topicName,
                        eventType: prop
                    })
                }
                return undefined
            }
        })
    },
    enumerable: false,
    configurable: true
})

Object.defineProperty(EventPublisherResource.prototype, 'spy', {
    get<TEventMap>(this: EventPublisherResource<TEventMap>): PublisherEventsSpy<TEventMap> {
        const topicName = this.topicName
        return new Proxy({} as PublisherEventsSpy<TEventMap>, {
            get(_target, prop) {
                if (typeof prop === 'string') {
                    return new GGSpyWith(GGEventsInterceptor, {
                        type: 'sns',
                        resourceName: topicName,
                        eventType: prop
                    })
                }
                return undefined
            }
        })
    },
    enumerable: false,
    configurable: true
})

Object.defineProperty(EventPublisherResource.prototype, 'inject', {
    get<TEventMap>(this: EventPublisherResource<TEventMap>): PublisherEventsInject<TEventMap> {
        const topicName = this.topicName
        return new Proxy({} as PublisherEventsInject<TEventMap>, {
            get(_target, prop) {
                if (typeof prop === 'string') {
                    return async (data: any): Promise<string> => {
                        const server = GG_TEST_RUNNER.get().getExtensionInstance(GGEventsServer)
                        return server.injectToTopic(topicName, {type: prop, data})
                    }
                }
                return undefined
            }
        })
    },
    enumerable: false,
    configurable: true
})
