import {GGContext} from "@grest-ts/context"
import type {GGRequirement} from "@grest-ts/schema"
import {GG_AUTHZ_SUBJECT, GGAuthz, type GGAuthzAuthority, type GGAuthzDecision, type GGAuthzRequest, GGAuthzRn, type GGAuthzSubject, type GGAuthzVerdict} from "../src/index-node"

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

/** What `authz` answers `subject` asking `action` on `resource`. */
export async function verdict(authz: GGAuthz, subject: GGAuthzSubject, action: string | {name: string}, resource: string, context?: Record<string, unknown>): Promise<GGAuthzVerdict> {
    const request: GGAuthzRequest = {subject, action: {name: typeof action === "string" ? action : action.name}, resource: {type: GGAuthzRn.type(resource) ?? "", id: resource}, context}
    return GGAuthz.verdict(request, await authz.evaluate(request))
}

/** The actions a `canHold` decision says aren't held. */
export function notHeld(decision: GGAuthzDecision): readonly string[] {
    return GGAuthz.notHeld(decision, [])
}

/** One requirement, as the only one of its call. */
export function check(authority: GGAuthzAuthority, requirement: GGRequirement, input: unknown): Promise<void> {
    return authority.authorize({api: "TestApi", method: "test"}, [requirement], input)
}

export function as<T>(subject: GGAuthzSubject | undefined, fn: () => Promise<T>): Promise<T> {
    return new GGContext("test").run(async () => {
        if (subject) GG_AUTHZ_SUBJECT.set(subject)
        return fn()
    })
}
