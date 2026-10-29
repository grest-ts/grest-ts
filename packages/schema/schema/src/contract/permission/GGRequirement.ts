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

/**
 * One requirement picked by the value of an input field, the discriminator of a discriminated union: each value
 * names its case, and `null` adds no check. The server picks the case from the validated input, so the authority
 * still sees a plain requirement. Build it with `byField`.
 */
export interface GGRequirementByField<Field extends string = string, Keys extends string = string, Errors extends ANY_ERROR_CLS = ANY_ERROR_CLS> {
    readonly __permission: "byField"
    /** The discriminator's path in the input, e.g. `scope.type`. */
    readonly field: Field
    readonly cases: Readonly<Record<Keys, GGRequirement<string, Errors> | null>>
    /** Every case's errors. */
    readonly errors: readonly Errors[]
    /** The union is the input's field at `path`: prefixes the discriminator and every case's fields. */
    at<const P extends string>(path: P): GGRequirementByField<`${P}.${Field}`, Keys, Errors>
    /** Only these cases, for an input whose union has only these variants. */
    pick<const K extends Keys>(keys: readonly K[]): GGRequirementByField<Field, K, Errors>
}

type CaseRequirement = GGRequirement<string, any> | null
/** A case for each value of `U[F]`, reading only its own variant's fields. */
export type GGRequirementCases<U, F extends keyof U & string> = {[K in U[F] & string]: GGRequirement<keyof Extract<U, Record<F, K>> & string, any> | null}
type CaseErrors<C> = {[K in keyof C]: C[K] extends {errors: readonly (infer E)[]} ? E : never}[keyof C]

export function isRequirementByField(p: unknown): p is GGRequirementByField {
    return typeof p === "object" && p !== null && (p as {__permission?: unknown}).__permission === "byField"
}

/** The value at a requirement's field path, e.g. `scope.projectId`. */
export function requirementField(input: unknown, path: string): unknown {
    let value = input
    for (const part of path.split(".")) value = value === null || typeof value !== "object" ? undefined : (value as Record<string, unknown>)[part]
    return value
}

function prefixed(r: GGRequirement, path: string): GGRequirement {
    const resource = (res: GGRequirementResource | undefined) => res && (res.id && "field" in res.id ? {...res, id: {field: `${path}.${res.id.field}`}} : res)
    return Object.freeze({...r, ...r.resource && {resource: resource(r.resource)}, ...r.createOn && {createOn: resource(r.createOn)}})
}

function makeByField(field: string, cases: Record<string, CaseRequirement>): GGRequirementByField {
    const errors = [...new Set(Object.values(cases).flatMap(c => c?.errors ?? []))]
    const data = {__permission: "byField", field, cases: Object.freeze({...cases}), errors: Object.freeze(errors)}
    Object.defineProperties(data, {
        at: {value: (path: string) => makeByField(`${path}.${field}`, Object.fromEntries(Object.entries(cases).map(([k, c]) => [k, c && prefixed(c, path)])))},
        pick: {value: (keys: readonly string[]) => makeByField(field, Object.fromEntries(keys.map(k => {
            if (!Object.hasOwn(cases, k)) throw new Error(`byField ${field}: no case ${k} to pick`)
            return [k, cases[k]!]
        })))},
    })
    return Object.freeze(data) as unknown as GGRequirementByField
}

/**
 * Picks the requirement by `union`'s discriminator `field`: a case for every value, none extra, each reading only
 * its own variant's fields (`null`: no check).
 *
 *     byField(IsScope, "type", {org: null, project: ReadProject.on("projectId")}).at("scope")
 */
export function byField<U, const F extends keyof U & string, const C extends GGRequirementCases<U, F>>(
    union: {infer: U},
    field: F,
    cases: C & Record<Exclude<keyof C, U[F]>, never>,
): GGRequirementByField<F, keyof C & string, CaseErrors<C> & ANY_ERROR_CLS> {
    return makeByField(field, cases as Record<string, CaseRequirement>) as never
}
