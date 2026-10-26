import type {ANY_ERROR_CLS} from "../ERROR";

/**
 * Where a requirement's resource id comes from: an input field, or a source the authority resolves from the
 * request context (e.g. the calling workspace). No id at all means the authority's default scope (e.g. the
 * caller's tenant).
 */
export type GGRequirementId<Field extends string = string> =
    | {readonly field: Field}
    | {readonly context: string}

export interface GGRequirementResource<Field extends string = string> {
    readonly type: string
    readonly id?: GGRequirementId<Field>
}

/**
 * A resource-scoped permission: the caller must be allowed `action` on `resource`. Pure data, so contracts stay
 * shareable with the browser; an authority registered on the API decides it after the input is validated.
 * Build them with a model library's helpers rather than by hand.
 */
export interface GGRequirement<Field extends string = string, Errors extends ANY_ERROR_CLS = ANY_ERROR_CLS> {
    readonly __permission: "requirement"
    readonly action: string
    /** Omitted only with `list`. */
    readonly resource?: GGRequirementResource<Field>
    /** For an upsert: when `resource`'s id field is absent from the input, check this resource (the parent) instead. */
    readonly createOn?: GGRequirementResource<Field>
    /** No check before the handler; the handler filters what it returns. */
    readonly list?: true
    /** A denial answers NOT_FOUND, so the resource's existence doesn't leak. */
    readonly hidden?: true
    /** What the authority can throw for it; merged into the method's `errors`. */
    readonly errors: readonly Errors[]
}

export function isRequirement(p: unknown): p is GGRequirement {
    return typeof p === "object" && p !== null && (p as {__permission?: unknown}).__permission === "requirement"
}
