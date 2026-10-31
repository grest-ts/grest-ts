import type {GGSchemaDescription} from "../../GGSchemaDescription";
import type {ANY_ERROR} from "../ERROR";
import type {GGContractMethod} from "../GGContractClass";
import type {GGRequirement, GGRequirementResource} from "./GGRequirement";
import {GGPermissionChecker} from "./GGPermissionChecker";

type RequirementsIn<P> = P extends GGRequirement<any> ? P : P extends {allOf: readonly (infer E)[]} ? RequirementsIn<E> : never
// A field typed plain `string` can't be checked here; contract construction still checks it.
type Literal<F> = string extends F ? never : F
type FieldOf<R> =
    | (R extends {id?: infer I} ? I extends {field: infer F extends string} ? Literal<F> : never : never)
    | (R extends {in?: infer P} ? P extends {field: infer F extends string} ? Literal<F> : never : never)
type RequirementFields<P> = RequirementsIn<P> extends infer R
    ? R extends {__permission: "requirement", resource?: infer A, createOn?: infer B} ? FieldOf<A> | FieldOf<B> : never
    : never
type InputOf<M> = M extends {input: {infer: infer I}} ? NonNullable<I> : never
type PermissionOf<M> = M extends {permission: infer P} ? P : never
/** The fields of `F` (paths such as `doc.folderId`) that `I` doesn't have. A path can't pass through a union. */
type MissingFields<F, I> = F extends keyof I ? never
    : F extends `${infer H}.${infer R}` ? H extends keyof I
        ? IsUnion<NonNullable<I[H]>> extends true ? F
        : [MissingFields<R, NonNullable<I[H]>>] extends [never] ? never : F
        : F
    : F
type IsUnion<T, U = T> = T extends unknown ? [U] extends [T] ? false : true : never
type MethodMissing<M> = MissingFields<RequirementFields<PermissionOf<M>>, InputOf<M>>

/** The errors a method's requirements add, for the client's error types. */
export type GGRequirementErrors<Method> = RequirementsIn<PermissionOf<Method>> extends {errors: readonly (infer E)[]}
    ? E extends {infer: infer F} ? F extends ANY_ERROR ? F : never : never
    : never

/** Compile-time half of the field check: a requirement may only read fields its method's input has. */
export type GGCheckRequirements<Methods> = {
    [K in keyof Methods]: [MethodMissing<Methods[K]>] extends [never]
        ? unknown
        : {permission: `requirement reads input.${MethodMissing<Methods[K]> & string}, which the input doesn't have`}
}

/** The node at `path` from `input`; every step must be a required property of an object, the last one only when
 *  `lastRequired` (an upsert's id may be absent). */
function nodeAt(input: GGSchemaDescription | undefined, path: string, at: string, shown: string, lastRequired: boolean): GGSchemaDescription {
    if (input?.optional || input?.nullable) {
        throw new Error(`${at}: the requirement reads input.${shown}, but the input itself is optional; make it required`)
    }
    if (!path) return input!
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

function checkField(resource: GGRequirementResource | undefined, required: boolean, input: GGSchemaDescription | undefined, at: string): void {
    if (resource?.in) return checkParent(resource.in.field, resource.in.types, input, at)
    const id = resource?.id
    if (!id || !("field" in id)) return
    nodeAt(input, id.field, at, id.field, required)
}

/** The parent field is a required `{type, id}` whose `type` can only be one of `types`. */
function checkParent(field: string, types: readonly string[], input: GGSchemaDescription | undefined, at: string): void {
    const parent = nodeAt(input, field, at, field, true)
    if (parent.nullable) throw new Error(`${at}: the requirement reads input.${field}, which is nullable; make it required`)
    const variants = parent.node.kind === "discriminated" ? parent.node.variants : [parent]
    for (const v of variants) {
        const node = v.node
        const tag = node.kind === "object" ? node.properties.type?.node : undefined
        if (node.kind !== "object" || tag?.kind !== "literal" || !node.properties.id) {
            throw new Error(`${at}: the requirement reads input.${field} as a parent, which must be {type, id} with a literal type`)
        }
        const other = tag.values.filter(t => !types.includes(t as string))
        if (other.length) throw new Error(`${at}: input.${field} may name ${other.join(", ")}, which the requirement's type can't be in (${types.join(", ")})`)
    }
}

function checkRequirement(r: GGRequirement, input: GGSchemaDescription | undefined, at: string): void {
    checkField(r.resource, !r.createOn, input, at)
    checkField(r.createOn, false, input, at)
}

/**
 * Checks a method's requirements against its input and adds their errors to its own. Other methods pass unchanged.
 * Expects an already validated permission.
 */
export function withRequirements<M extends GGContractMethod>(method: M, at: string): M {
    const requirements = GGPermissionChecker.requirementsOf(method.permission)
    if (!requirements.length) return method
    const input = method.input?.toSchemaDescription()
    const errors = [...method.errors ?? []]
    for (const r of requirements) {
        checkRequirement(r, input, at)
        for (const e of r.errors) if (!errors.includes(e)) errors.push(e)
    }
    return {...method, errors}
}

/** Requirements need an authority, which only the HTTP server runs. */
export function assertNoRequirements(name: string, methods: Record<string, GGContractMethod | undefined>): void {
    for (const [at, m] of Object.entries(methods)) {
        if (GGPermissionChecker.requirementsOf(m?.permission).length) throw new Error(`Socket contract ${name}.${at}: requirements are only supported on HTTP methods`)
    }
}
