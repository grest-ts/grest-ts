// Schema creation functions for @grest-ts/schema
import {GGIssueKey, IsArray, IsBoolean, IsDiscriminated, IsNumber, IsObject, IsString, IsTuple, NumberSchema, ObjectSchema} from "@grest-ts/schema";
import {ALPHANUMERIC_REGEX, EMAIL_REGEX, PASSWORD_REGEX, URL_REGEX} from "../regexPatterns";
import {RecursiveData} from "../../tests/tests/recursiveTestData";

// Refine error instances (reused across schema creations)
const alphanumericError = new GGIssueKey("refine.alphanumeric", "Must be alphanumeric");
const emailError = new GGIssueKey("refine.email", "Must be valid email");
const adultError = new GGIssueKey("refine.adult", "Must be adult");
const passwordError = new GGIssueKey("refine.password", "Must be strong password");
const urlError = new GGIssueKey("refine.url", "Must be valid URL");

export function createNumberSchema() {
    return new NumberSchema({type: 'number'});
}

export function createSimpleSchema() {
    return IsObject({
        name: IsString.nonEmpty.maxLength(100),
        age: IsNumber.min(0).max(150),
        email: IsString.nonEmpty,
        active: IsBoolean,
        tags: IsArray(IsString)
    });
}

export function createNestedSchema() {
    return IsObject({
        id: IsNumber,
        user: IsObject({
            name: IsString.nonEmpty,
            email: IsString.nonEmpty,
            profile: IsObject({
                bio: IsString,
                website: IsString,
                social: IsObject({
                    twitter: IsString,
                    github: IsString
                })
            })
        }),
        metadata: IsObject({
            createdAt: IsNumber,
            updatedAt: IsNumber,
            version: IsNumber
        }),
        tags: IsArray(IsString)
    });
}

export function createRefineSchema() {
    return IsObject({
        username: IsString.minLength(3).maxLength(20).refine(s => ALPHANUMERIC_REGEX.test(s), alphanumericError),
        email: IsString.refine(s => EMAIL_REGEX.test(s), emailError),
        age: IsNumber.min(0).max(150).refine(n => n >= 18, adultError),
        password: IsString.refine(s => PASSWORD_REGEX.test(s), passwordError),
        website: IsString.refine(s => URL_REGEX.test(s), urlError)
    });
}

export function createDiscriminatedSchema() {
    return IsDiscriminated('type', {
        user: IsObject({
            type: 'user' as const,
            name: IsString.nonEmpty,
            email: IsString.nonEmpty
        }),
        admin: IsObject({
            type: 'admin' as const,
            name: IsString.nonEmpty,
            email: IsString.nonEmpty,
            level: IsNumber.min(1).max(10)
        }),
        guest: IsObject({
            type: 'guest' as const,
            sessionId: IsString.nonEmpty
        })
    });
}

export function createRecursiveSchema(): ObjectSchema<RecursiveData> {
    const RecursiveNodeSchema: ObjectSchema<RecursiveData> = IsObject(() => ({
        name: IsString,
        value: IsNumber,
        children: IsArray(() => RecursiveNodeSchema).orUndefined
    }));
    return RecursiveNodeSchema;
}

export function createTupleSchema() {
    return IsObject({
        coords: IsTuple(IsNumber, IsNumber, IsNumber),
        range: IsTuple(IsNumber, IsNumber),
        mixed: IsTuple(IsString, IsNumber, IsBoolean)
    });
}

export function createBigStringSchema() {
    return IsObject({
        content: IsString,
        description: IsString,
        metadata: IsString
    });
}

export function createBigArraySchema() {
    return IsObject({
        items: IsArray(IsObject({
            id: IsNumber,
            name: IsString,
            value: IsNumber
        }))
    });
}
