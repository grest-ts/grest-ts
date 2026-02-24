// Schema creation functions
import {Type} from "@sinclair/typebox";
import {ALPHANUMERIC_PATTERN, EMAIL_PATTERN, PASSWORD_PATTERN, URL_PATTERN} from "../regexPatterns";

export function createSimpleSchema() {
    return Type.Object({
        name: Type.String({minLength: 1, maxLength: 100}),
        age: Type.Number({minimum: 0, maximum: 150}),
        email: Type.String({minLength: 1}),
        active: Type.Boolean(),
        tags: Type.Array(Type.String())
    });
}

export function createNestedSchema() {
    return Type.Object({
        id: Type.Number(),
        user: Type.Object({
            name: Type.String({minLength: 1}),
            email: Type.String({minLength: 1}),
            profile: Type.Object({
                bio: Type.String(),
                website: Type.String(),
                social: Type.Object({
                    twitter: Type.String(),
                    github: Type.String()
                })
            })
        }),
        metadata: Type.Object({
            createdAt: Type.Number(),
            updatedAt: Type.Number(),
            version: Type.Number()
        }),
        tags: Type.Array(Type.String())
    });
}

export function createRefineSchema() {
    return Type.Object({
        username: Type.String({minLength: 3, maxLength: 20, pattern: ALPHANUMERIC_PATTERN}),
        email: Type.String({pattern: EMAIL_PATTERN}),
        age: Type.Number({minimum: 18, maximum: 150}),
        password: Type.String({pattern: PASSWORD_PATTERN}),
        website: Type.String({pattern: URL_PATTERN})
    });
}

export function createDiscriminatedSchema() {
    return Type.Union([
        Type.Object({
            type: Type.Literal('user'),
            name: Type.String({minLength: 1}),
            email: Type.String({minLength: 1})
        }),
        Type.Object({
            type: Type.Literal('admin'),
            name: Type.String({minLength: 1}),
            email: Type.String({minLength: 1}),
            level: Type.Number({minimum: 1, maximum: 10})
        }),
        Type.Object({
            type: Type.Literal('guest'),
            sessionId: Type.String({minLength: 1})
        })
    ]);
}

export function createRecursiveSchema() {
    return Type.Recursive((Self) => Type.Object({
        name: Type.String(),
        value: Type.Number(),
        children: Type.Optional(Type.Array(Self))
    }));
}

export function createTupleSchema() {
    return Type.Object({
        coords: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
        range: Type.Tuple([Type.Number(), Type.Number()]),
        mixed: Type.Tuple([Type.String(), Type.Number(), Type.Boolean()])
    });
}

export function createBigStringSchema() {
    return Type.Object({
        content: Type.String(),
        description: Type.String(),
        metadata: Type.String()
    });
}

export function createBigArraySchema() {
    return Type.Object({
        items: Type.Array(Type.Object({
            id: Type.Number(),
            name: Type.String(),
            value: Type.Number()
        }))
    });
}