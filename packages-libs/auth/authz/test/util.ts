import {GGContext} from "@grest-ts/context"
import {GG_AUTHZ_SUBJECT, type GGAuthzRequest, GGAuthzRn, type GGAuthzSubject} from "../src/index-node"

export async function filterAsync<T>(items: readonly T[], keep: (item: T) => Promise<boolean>): Promise<T[]> {
    const kept = await Promise.all(items.map(keep))
    return items.filter((_, i) => kept[i])
}

export function entity(key: string): {type: string, id: string} {
    return {type: key.slice(0, key.indexOf(":")), id: key.slice(key.indexOf(":") + 1)}
}

export function subject(key: string, onBehalfOf?: string, scopes?: string[]): GGAuthzSubject {
    return {...entity(key), properties: onBehalfOf || scopes ? {onBehalfOf: onBehalfOf ? entity(onBehalfOf) : undefined, scopes} : undefined}
}

export function req(key: string, action: string, resource: string, extra: {for?: string, scopes?: string[], context?: Record<string, unknown>} = {}): GGAuthzRequest {
    return {
        subject: subject(key, extra.for, extra.scopes),
        action: {name: action},
        resource: {type: GGAuthzRn.type(resource) ?? "unknown:unknown", id: resource},
        context: extra.context,
    }
}

export function as<T>(subject: GGAuthzSubject | undefined, fn: () => Promise<T>): Promise<T> {
    return new GGContext("test").run(async () => {
        if (subject) GG_AUTHZ_SUBJECT.set(subject)
        return fn()
    })
}
