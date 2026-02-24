// Schema creation functions
import {ALPHANUMERIC_REGEX, EMAIL_REGEX, PASSWORD_REGEX, URL_REGEX} from "../regexPatterns";
import {z, ZodType} from "zod";
import {RecursiveData} from "../../tests/tests/recursiveTestData";

export function createSimpleSchema() {
    return z.object({
        name: z.string().min(1).max(100),
        age: z.number().min(0).max(150),
        email: z.string().min(1),
        active: z.boolean(),
        tags: z.array(z.string())
    }).strip();
}

export function createNestedSchema() {
    return z.object({
        id: z.number(),
        user: z.object({
            name: z.string().min(1),
            email: z.string().min(1),
            profile: z.object({
                bio: z.string(),
                website: z.string(),
                social: z.object({
                    twitter: z.string(),
                    github: z.string()
                })
            })
        }),
        metadata: z.object({
            createdAt: z.number(),
            updatedAt: z.number(),
            version: z.number()
        }),
        tags: z.array(z.string())
    }).strip();
}

export function createRefineSchema() {
    return z.object({
        username: z.string().min(3).max(20).refine(s => ALPHANUMERIC_REGEX.test(s), "alphanumeric"),
        email: z.string().refine(s => EMAIL_REGEX.test(s), "valid email"),
        age: z.number().min(0).max(150).refine(n => n >= 18, "must be adult"),
        password: z.string().refine(s => PASSWORD_REGEX.test(s), "strong password"),
        website: z.string().refine(s => URL_REGEX.test(s), "valid url")
    }).strip();
}

export function createDiscriminatedSchema() {
    return z.discriminatedUnion('type', [
        z.object({
            type: z.literal('user'),
            name: z.string().min(1),
            email: z.string().min(1)
        }).strip(),
        z.object({
            type: z.literal('admin'),
            name: z.string().min(1),
            email: z.string().min(1),
            level: z.number().min(1).max(10)
        }).strip(),
        z.object({
            type: z.literal('guest'),
            sessionId: z.string().min(1)
        }).strip()
    ]);
}

export function createRecursiveSchema(): ZodType<RecursiveData> {
    const baseSchema = z.object({
        name: z.string(),
        value: z.number()
    });
    type RecursiveInput = z.infer<typeof baseSchema> & { children?: RecursiveInput[] };
    const recursiveSchema: z.ZodType<RecursiveInput> = baseSchema.extend({
        children: z.lazy(() => recursiveSchema.array().optional())
    });
    return recursiveSchema as ZodType<RecursiveData>;
}

export function createTupleSchema() {
    return z.object({
        coords: z.tuple([z.number(), z.number(), z.number()]),
        range: z.tuple([z.number(), z.number()]),
        mixed: z.tuple([z.string(), z.number(), z.boolean()])
    }).strip();
}

export function createBigStringSchema() {
    return z.object({
        content: z.string(),
        description: z.string(),
        metadata: z.string()
    }).strip();
}

export function createBigArraySchema() {
    return z.object({
        items: z.array(z.object({
            id: z.number(),
            name: z.string(),
            value: z.number()
        }))
    }).strip();
}