// Schema creation functions
import * as v from "valibot";
import {ALPHANUMERIC_REGEX, EMAIL_REGEX, PASSWORD_REGEX, URL_REGEX} from "../regexPatterns";
import {RecursiveData} from "../../lib/TestRunner";

export function createSimpleSchema() {
    return v.pipe(
        v.object({
            name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
            age: v.pipe(v.number(), v.minValue(0), v.maxValue(150)),
            email: v.pipe(v.string(), v.minLength(1)),
            active: v.boolean(),
            tags: v.array(v.string())
        }),
        v.transform((obj) => ({
            name: obj.name,
            age: obj.age,
            email: obj.email,
            active: obj.active,
            tags: obj.tags
        }))
    );
}

export function createNestedSchema() {
    return v.pipe(
        v.object({
            id: v.number(),
            user: v.object({
                name: v.pipe(v.string(), v.minLength(1)),
                email: v.pipe(v.string(), v.minLength(1)),
                profile: v.object({
                    bio: v.string(),
                    website: v.string(),
                    social: v.object({
                        twitter: v.string(),
                        github: v.string()
                    })
                })
            }),
            metadata: v.object({
                createdAt: v.number(),
                updatedAt: v.number(),
                version: v.number()
            }),
            tags: v.array(v.string())
        }),
        v.transform((obj) => ({
            id: obj.id,
            user: {
                name: obj.user.name,
                email: obj.user.email,
                profile: {
                    bio: obj.user.profile.bio,
                    website: obj.user.profile.website,
                    social: {
                        twitter: obj.user.profile.social.twitter,
                        github: obj.user.profile.social.github
                    }
                }
            },
            metadata: {
                createdAt: obj.metadata.createdAt,
                updatedAt: obj.metadata.updatedAt,
                version: obj.metadata.version
            },
            tags: obj.tags
        }))
    );
}

export function createRefineSchema() {
    return v.pipe(
        v.object({
            username: v.pipe(
                v.string(),
                v.minLength(3),
                v.maxLength(20),
                v.check(s => ALPHANUMERIC_REGEX.test(s), "alphanumeric")
            ),
            email: v.pipe(
                v.string(),
                v.check(s => EMAIL_REGEX.test(s), "valid email")
            ),
            age: v.pipe(
                v.number(),
                v.minValue(0),
                v.maxValue(150),
                v.check(n => n >= 18, "must be adult")
            ),
            password: v.pipe(
                v.string(),
                v.check(s => PASSWORD_REGEX.test(s), "strong password")
            ),
            website: v.pipe(
                v.string(),
                v.check(s => URL_REGEX.test(s), "valid url")
            )
        }),
        v.transform((obj) => ({
            username: obj.username,
            email: obj.email,
            age: obj.age,
            password: obj.password,
            website: obj.website
        }))
    );
}

export function createDiscriminatedSchema() {
    return v.variant('type', [
        v.pipe(
            v.object({
                type: v.literal('user'),
                name: v.pipe(v.string(), v.minLength(1)),
                email: v.pipe(v.string(), v.minLength(1))
            }),
            v.transform((obj) => ({type: obj.type, name: obj.name, email: obj.email}))
        ),
        v.pipe(
            v.object({
                type: v.literal('admin'),
                name: v.pipe(v.string(), v.minLength(1)),
                email: v.pipe(v.string(), v.minLength(1)),
                level: v.pipe(v.number(), v.minValue(1), v.maxValue(10))
            }),
            v.transform((obj) => ({type: obj.type, name: obj.name, email: obj.email, level: obj.level}))
        ),
        v.pipe(
            v.object({
                type: v.literal('guest'),
                sessionId: v.pipe(v.string(), v.minLength(1))
            }),
            v.transform((obj) => ({type: obj.type, sessionId: obj.sessionId}))
        )
    ]);
}

export function createRecursiveSchema(): v.GenericSchema<RecursiveData> {
    const schema: v.GenericSchema<RecursiveData> = v.object({
        name: v.string(),
        value: v.number(),
        children: v.optional(v.array(v.lazy(() => schema)))
    });
    return schema;
}

export function createTupleSchema() {
    return v.pipe(
        v.object({
            coords: v.tuple([v.number(), v.number(), v.number()]),
            range: v.tuple([v.number(), v.number()]),
            mixed: v.tuple([v.string(), v.number(), v.boolean()])
        }),
        v.transform((obj) => ({
            coords: obj.coords,
            range: obj.range,
            mixed: obj.mixed
        }))
    );
}

export function createBigStringSchema() {
    return v.pipe(
        v.object({
            content: v.string(),
            description: v.string(),
            metadata: v.string()
        }),
        v.transform((obj) => ({
            content: obj.content,
            description: obj.description,
            metadata: obj.metadata
        }))
    );
}

export function createBigArraySchema() {
    return v.pipe(
        v.object({
            items: v.array(v.object({
                id: v.number(),
                name: v.string(),
                value: v.number()
            }))
        }),
        v.transform((obj) => ({
            items: obj.items.map(item => ({
                id: item.id,
                name: item.name,
                value: item.value
            }))
        }))
    );
}