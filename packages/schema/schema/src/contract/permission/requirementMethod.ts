import type {ANY_ERROR} from "../ERROR";
import type {GGContractMethod} from "../GGContractClass";
import {GGPermissionChecker} from "./GGPermissionChecker";
import type {GGRequirement, GGRequirementResource} from "./GGRequirement";

type RequirementsIn<P> = P extends GGRequirement<any> ? P : P extends {allOf: readonly (infer E)[]} ? RequirementsIn<E> : never
// A field typed plain `string` can't be checked here; contract construction still checks it.
type FieldOf<R> = R extends {id?: infer I} ? I extends {field: infer F extends string} ? string extends F ? never : F : never : never
type RequirementFields<P> = RequirementsIn<P> extends infer R ? R extends {resource?: infer A, createOn?: infer B} ? FieldOf<A> | FieldOf<B> : never : never
type InputKeys<M> = M extends {input: {infer: infer I}} ? keyof NonNullable<I> & string : never
type PermissionOf<M> = M extends {permission: infer P} ? P : never

/** The errors a method's requirements add, for the client's error types. */
export type GGRequirementErrors<Method> = RequirementsIn<PermissionOf<Method>> extends {errors: readonly (infer E)[]}
    ? E extends {infer: infer F} ? F extends ANY_ERROR ? F : never : never
    : never

/** Compile-time half of the field check: a requirement may only read fields its method's input has. */
export type GGCheckRequirements<Methods> = {
    [K in keyof Methods]: [Exclude<RequirementFields<PermissionOf<Methods[K]>>, InputKeys<Methods[K]>>] extends [never]
        ? unknown
        : {permission: `requirement reads input.${Exclude<RequirementFields<PermissionOf<Methods[K]>>, InputKeys<Methods[K]>>}, which the input doesn't have`}
}

function checkField(resource: GGRequirementResource | undefined, required: boolean, input: GGContractMethod["input"], at: string): void {
    const id = resource?.id
    if (!id || !("field" in id)) return
    const node = input?.toSchemaDescription().node
    if (node?.kind !== "object" || !(id.field in node.properties)) {
        throw new Error(`${at}: the requirement reads input.${id.field}, which the input doesn't have`)
    }
    if (required && !node.required.includes(id.field)) {
        throw new Error(`${at}: the requirement reads input.${id.field}, which is optional; make it required or add createOn for an upsert`)
    }
}

/** Checks a method's requirements against its input and adds their errors to its own. Other methods pass unchanged. */
export function withRequirements<M extends GGContractMethod>(method: M, at: string): M {
    const requirements = GGPermissionChecker.requirementsOf(method.permission)
    if (!requirements.length) return method
    GGPermissionChecker.validatePermission(method.permission!, `${at}.permission`)
    const errors = [...method.errors ?? []]
    for (const r of requirements) {
        checkField(r.resource, !r.createOn, method.input, at)
        checkField(r.createOn, false, method.input, at)
        for (const e of r.errors) if (!errors.includes(e)) errors.push(e)
    }
    return {...method, errors}
}
