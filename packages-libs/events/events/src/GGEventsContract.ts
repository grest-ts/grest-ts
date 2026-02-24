import {GGContractMethod, GGPromise, SERVER_ERROR} from "@grest-ts/schema";

export interface GGEventsContract<TEventMap> {
    apiName: string
    topicName: string
    events: {
        [K in keyof TEventMap]: GGContractMethod<TEventMap[K]>
    }
}

export type GGEventsApi = Record<string, GGContractMethod<any>>

export type GGEventApi<TContract> = {
    [K in keyof TContract]: TContract[K] extends { input: { infer: infer I } } ? (input: I) => GGPromise<void, typeof SERVER_ERROR.infer> : never
}

const VALID_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/

export function validateEventName(name: string, kind: string): void {
    if (!VALID_NAME_PATTERN.test(name)) {
        throw new Error(
            `Invalid ${kind} name "${name}": must start with a letter and contain only letters, numbers, and underscores`
        )
    }
}
