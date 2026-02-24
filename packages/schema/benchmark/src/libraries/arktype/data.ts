// @ts-nocheck - arktype requires strictNullChecks which this project doesn't use
// Schema creation functions
import {type} from "arktype";
import {ALPHANUMERIC_REGEX, EMAIL_REGEX, PASSWORD_REGEX, URL_REGEX} from "../regexPatterns";

export function createSimpleSchema() {
    return type({
        name: "1<=string<=100",
        age: "0<=number<=150",
        email: "string>0",
        active: "boolean",
        tags: "string[]"
    }).onUndeclaredKey("delete");
}

export function createNestedSchema() {
    return type({
        id: "number",
        user: {
            name: "string>0",
            email: "string>0",
            profile: {
                bio: "string",
                website: "string",
                social: {
                    twitter: "string",
                    github: "string"
                }
            }
        },
        metadata: {
            createdAt: "number",
            updatedAt: "number",
            version: "number"
        },
        tags: "string[]"
    }).onDeepUndeclaredKey("delete");
}

export function createRefineSchema() {
    // Use per-field narrowing so each field validates independently
    const Username = type("3<=string<=20").narrow((s, ctx) =>
        ALPHANUMERIC_REGEX.test(s) || ctx.mustBe("alphanumeric")
    );
    const Email = type("string").narrow((s, ctx) =>
        EMAIL_REGEX.test(s) || ctx.mustBe("valid email format")
    );
    const Age = type("18<=number<=150");
    const Password = type("string").narrow((s, ctx) =>
        PASSWORD_REGEX.test(s) || ctx.mustBe("strong password")
    );
    const Website = type("string").narrow((s, ctx) =>
        URL_REGEX.test(s) || ctx.mustBe("valid URL")
    );

    return type({
        username: Username,
        email: Email,
        age: Age,
        password: Password,
        website: Website
    }).onUndeclaredKey("delete");
}

export function createDiscriminatedSchema() {
    const UserType = type({
        type: "'user'",
        name: "string>0",
        email: "string>0"
    }).onUndeclaredKey("delete");
    const AdminType = type({
        type: "'admin'",
        name: "string>0",
        email: "string>0",
        level: "1<=number<=10"
    }).onUndeclaredKey("delete");
    const GuestType = type({
        type: "'guest'",
        sessionId: "string>0"
    }).onUndeclaredKey("delete");
    return UserType.or(AdminType).or(GuestType);
}

// Arktype supports recursive types with type.module
const recursiveModule = type.module({
    node: {
        "+": "delete",  // Strip undeclared keys
        name: "string",
        value: "number",
        "children?": "node[]"
    }
});

export function createRecursiveSchema() {
    return recursiveModule.node;
}

export function createTupleSchema() {
    return type({
        coords: ["number", "number", "number"],
        range: ["number", "number"],
        mixed: ["string", "number", "boolean"]
    }).onUndeclaredKey("delete");
}

export function createBigStringSchema() {
    return type({
        content: "string",
        description: "string",
        metadata: "string"
    }).onUndeclaredKey("delete");
}

export function createBigArraySchema() {
    return type({
        items: type({
            id: "number",
            name: "string",
            value: "number"
        }).onUndeclaredKey("delete").array()
    }).onUndeclaredKey("delete");
}