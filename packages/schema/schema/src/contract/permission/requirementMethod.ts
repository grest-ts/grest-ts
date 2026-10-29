import type {GGSchemaDescription} from "../../GGSchemaDescription";
import type {ANY_ERROR} from "../ERROR";
import type {GGContractMethod} from "../GGContractClass";
import type {GGPermission} from "./GGPermission";
import {type GGRequirement, type GGRequirementByField, type GGRequirementResource, isRequirement, isRequirementByField} from "./GGRequirement";

type RequirementsIn<P> = P extends GGRequirement<any> | GGRequirementByField<any, any, any> ? P : P extends {allOf: readonly (infer E)[]} ? RequirementsIn<E> : never
// A field typed plain `string` can't be checked here; contract construction still checks it.
type FieldOf<R> = R extends {id?: infer I} ? I extends {field: infer F extends string} ? string extends F ? never : F : never : never
// A byField's cases were checked against their variants by `byField`; here only its discriminator is.
type RequirementFields<P> = RequirementsIn<P> extends infer R
    ? R extends GGRequirementByField<infer F, any, any> ? string extends F ? never : F
    : R extends {resource?: infer A, createOn?: infer B} ? FieldOf<A> | FieldOf<B> : never
    : never
type InputOf<M> = M extends {input: {infer: infer I}} ? NonNullable<I> : never
type PermissionOf<M> = M extends {permission: infer P} ? P : never
/** The fields of `F` (paths such as `scope.projectId`) that `I` doesn't have; a path can't pass through a union's
 *  variant-only field. */
type MissingFields<F, I> = F extends keyof I ? never
    : F extends `${infer H}.${infer R}` ? H extends keyof I ? [MissingFields<R, NonNullable<I[H]>>] extends [never] ? never : F : F
    : F

/** The errors a method's requirements add, for the client's error types. */
export type GGRequirementErrors<Method> = RequirementsIn<PermissionOf<Method>> extends {errors: readonly (infer E)[]}
    ? E extends {infer: infer F} ? F extends ANY_ERROR ? F : never : never
    : never

/** Compile-time half of the field check: a requirement may only read fields its method's input has. */
export type GGCheckRequirements<Methods> = {
    [K in keyof Methods]: [MissingFields<RequirementFields<PermissionOf<Methods[K]>>, InputOf<Methods[K]>>] extends [never]
        ? unknown
        : {permission: `requirement reads input.${MissingFields<RequirementFields<PermissionOf<Methods[K]>>, InputOf<Methods[K]>> & string}, which the input doesn't have`}
}

/** The requirements and byFields in a permission, as written. */
function entriesOf(p: GGPermission | undefined): (GGRequirement | GGRequirementByField)[] {
    if (isRequirement(p) || isRequirementByField(p)) return [p]
    if (p && typeof p === "object" && "allOf" in p) return p.allOf.flatMap(entriesOf)
    return []
}

/** The node at `path` from `input`; every step must be a required property of an object, the last one only when
 *  `lastRequired` (an upsert's id may be absent). */
function nodeAt(input: GGSchemaDescription | undefined, path: string, at: string, shown: string, lastRequired: boolean): GGSchemaDescription {
    if (input?.optional || input?.nullable) {
        throw new Error(`${at}: the requirement reads input.${shown}, but the input itself is optional; make it required`)
    }
    const parts = path.split(".")
    let desc = input
    parts.forEach((part, i) => {
        const node = desc?.node
        if (node?.kind !== "object" || !(part in node.properties)) {
            throw new Error(`${at}: the requirement reads input.${shown}, which the input doesn't have`)
        }
        const last = i === parts.length - 1
        desc = node.properties[part]!
        if ((lastRequired || !last) && (!node.required.includes(part) || (!last && desc.nullable))) {
            throw new Error(`${at}: the requirement reads input.${shown}, which is optional; make it required${last ? " or add createOn for an upsert" : ""}`)
        }
    })
    return desc!
}

function checkField(resource: GGRequirementResource | undefined, required: boolean, input: GGSchemaDescription | undefined, at: string, base = ""): void {
    const id = resource?.id
    if (!id || !("field" in id)) return
    if (base && !id.field.startsWith(`${base}.`)) throw new Error(`${at}: the requirement reads input.${id.field}, outside its byField's input.${base}`)
    nodeAt(input, base ? id.field.slice(base.length + 1) : id.field, at, id.field, required)
}

function checkRequirement(r: GGRequirement, input: GGSchemaDescription | undefined, at: string, base?: string): void {
    checkField(r.resource, !r.createOn, input, at, base)
    checkField(r.createOn, false, input, at, base)
}

/** The discriminator must pick one of a discriminated union's variants (or a lone variant's), with a case for each. */
function checkByField(p: GGRequirementByField, input: GGSchemaDescription | undefined, at: string): void {
    const dot = p.field.lastIndexOf(".")
    const base = dot < 0 ? "" : p.field.slice(0, dot)
    const discriminator = p.field.slice(dot + 1)
    const union = base ? nodeAt(input, base, at, p.field, true) : input
    if (!base && (input?.optional || input?.nullable)) throw new Error(`${at}: the byField reads input.${p.field}, but the input itself is optional; make it required`)
    const node = union?.node
    const variants = node?.kind === "discriminated" && node.discriminator === discriminator ? node.variants : node?.kind === "object" ? [union!] : []
    const byValue = new Map<string, GGSchemaDescription>()
    for (const v of variants) {
        const tag = v.node.kind === "object" ? v.node.properties[discriminator]?.node : undefined
        if (tag?.kind === "literal") for (const value of tag.values) byValue.set(String(value), v)
    }
    if (!byValue.size) throw new Error(`${at}: the byField reads input.${p.field}, which isn't a discriminated union's discriminator`)
    const missing = [...byValue.keys()].filter(k => !Object.hasOwn(p.cases, k))
    if (missing.length) throw new Error(`${at}: the byField on input.${p.field} has no case for ${missing.join(", ")}`)
    const extra = Object.keys(p.cases).filter(k => !byValue.has(k))
    if (extra.length) throw new Error(`${at}: the byField on input.${p.field} has a case for ${extra.join(", ")}, which the input can't hold`)
    for (const [k, c] of Object.entries(p.cases)) if (c) checkRequirement(c, byValue.get(k), `${at} (case ${k})`, base)
}

/**
 * Checks a method's requirements against its input and adds their errors to its own. Other methods pass unchanged.
 * Expects an already validated permission.
 */
export function withRequirements<M extends GGContractMethod>(method: M, at: string): M {
    const entries = entriesOf(method.permission)
    if (!entries.length) return method
    const input = method.input?.toSchemaDescription()
    const errors = [...method.errors ?? []]
    for (const r of entries) {
        if (isRequirementByField(r)) checkByField(r, input, at)
        else checkRequirement(r, input, at)
        for (const e of r.errors) if (!errors.includes(e)) errors.push(e)
    }
    return {...method, errors}
}

/** Requirements need an authority, which only the HTTP server runs. */
export function assertNoRequirements(name: string, methods: Record<string, GGContractMethod | undefined>): void {
    for (const [at, m] of Object.entries(methods)) {
        if (entriesOf(m?.permission).length) throw new Error(`Socket contract ${name}.${at}: requirements are only supported on HTTP methods`)
    }
}
