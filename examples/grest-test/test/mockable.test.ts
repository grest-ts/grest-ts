import {callOn, GGCallInterceptor, GGTest, mockOf, spyOn} from "@grest-ts/testkit"
import {mockable} from "@grest-ts/testkit-runtime"
import {SERVER_ERROR} from "@grest-ts/schema"
import {MockableRuntime} from "../src/MockableRuntime"
import {MockableApi} from "../src/api/MockableApi"
import {UPSTREAM_REFUSED, Upstream} from "../src/services/mockable/Upstream"

describe("mockOf on a @mockable class", () => {
    GGTest.startWorker(MockableRuntime)
    const client = callOn(MockableApi)

    describe("the input matchers and andReturn callbacks see", () => {

        test("an only argument as itself", async () => {
            await client.lookup({id: "a"})
                .with(mockOf(Upstream).lookup.toEqual({id: "a"}).andReturn(input => "mocked:" + input.id))
                .toEqual("mocked:a")
        })

        test("an only argument as itself, also when destructured or a primitive", async () => {
            await client.tagged({id: "a", tag: "t"})
                .with(mockOf(Upstream).tagged.toEqual({id: "a", tag: "t"}).andReturn(({id, tag}) => `mocked:${id}:${tag}`))
                .toEqual("mocked:a:t")
            await client.named({id: "a"})
                .with(mockOf(Upstream).named.toEqual("a").andReturn(id => "mocked:" + id))
                .toEqual("mocked:a")
        })

        test("several arguments as a tuple", async () => {
            await client.pair({id: "a", count: 2})
                .with(mockOf(Upstream).pair.toEqual(["a", 2]).andReturn(([id, count]) => `mocked:${id}x${count}`))
                .toEqual("mocked:ax2")
        })
    })

    describe("an async function field is mocked like a method", () => {

        test("mockOf", async () => {
            await client.field({id: "a", count: 2})
                .with(mockOf(Upstream).field.toEqual(["a", 2]).andReturn(([id]) => "mocked:" + id))
                .toEqual("mocked:a")
        })

        test("spyOn", async () => {
            await client.field({id: "a", count: 2})
                .with(spyOn(Upstream).field.toEqual(["a", 2]).responseToMatchObject("real:ax2"))
                .toEqual("real:ax2")
        })

        test("unmocked, it runs for real", async () => {
            await client.field({id: "a", count: 2}).toEqual("real:ax2")
        })
    })

    describe("errors reach the code under test typed, with their data", () => {

        test("an error passed to andReturn is thrown", async () => {
            await client.lookup({id: "a"})
                .with(mockOf(Upstream).lookup.andReturn(new UPSTREAM_REFUSED({reason: "quota"})))
                .toEqual("refused:quota")
        })

        test("an error thrown by an async callback", async () => {
            await client.lookup({id: "a"})
                .with(mockOf(Upstream).lookup.andReturn(async () => {
                    throw new UPSTREAM_REFUSED({reason: "revoked"})
                }))
                .toEqual("refused:revoked")
        })

        test("with its context, up to the client", async () => {
            await client.named({id: "a"})
                .with(mockOf(Upstream).named.andReturn(new SERVER_ERROR({displayMessage: "upstream is down"})))
                .toBeError(SERVER_ERROR, {displayMessage: "upstream is down"})
        })

        test("a plain error thrown by a callback fails the call", async () => {
            await client.named({id: "a"})
                .with(mockOf(Upstream).named.andReturn(() => {
                    throw new Error("connect ETIMEDOUT")
                }))
                .toBeError(SERVER_ERROR)
        })
    })

    test("a schema mock's callback throwing a typed error answers with it", async () => {
        await client.named({id: "a"})
            .with(MockableApi.mock.named.andReturn(async () => {
                throw new SERVER_ERROR({displayMessage: "mocked refusal"})
            }))
            .toBeError(SERVER_ERROR, {displayMessage: "mocked refusal"})
    })

    test("an async callback's result is awaited", async () => {
        await client.named({id: "a"})
            .with(mockOf(Upstream).named.andReturn(async id => {
                await new Promise(resolve => setTimeout(resolve, 10))
                return "late:" + id
            }))
            .toEqual("late:a")
    })

    describe("anyTimes()", () => {

        test("allows no calls", async () => {
            await client.named({id: "a"})
                .with(mockOf(Upstream).lookup.anyTimes().andReturn("unused"))
                .toEqual("real:a")
        })

        test("allows several calls", async () => {
            const interceptor = mockOf(Upstream).named.anyTimes().andReturn("mocked").createInterceptor() as GGCallInterceptor
            for (let i = 0; i < 3; i++) await interceptor.onRequest("a")
            expect(() => interceptor.validate()).not.toThrow()
        })
    })

    test("a method inherited from a @mockable class is mocked as the parent's", () => {
        class Child extends Upstream {
        }
        expect((mockOf(Child).named.createInterceptor() as GGCallInterceptor).getKey()).toBe("Upstream.named")
    })

    test("toBeError fails when the error's context doesn't match", async () => {
        await expect(client.named({id: "a"})
            .with(mockOf(Upstream).named.andReturn(new SERVER_ERROR({displayMessage: "upstream is down"})))
            .toBeError(SERVER_ERROR, {displayMessage: "something else"})
        ).rejects.toThrow(/Context of error 'SERVER_ERROR'/)
    })

    test("an unexpected error's rejection carries its display message and the error", async () => {
        const error = await client.named({id: "a"})
            .with(mockOf(Upstream).named.andReturn(new SERVER_ERROR({displayMessage: "upstream is down"})))
            .then(() => undefined, (e: Error) => e)
        expect(error?.message).toContain("SERVER_ERROR': upstream is down")
        expect(SERVER_ERROR.is(error?.cause)).toBe(true)
    })
})

describe("what @mockable can't intercept fails loudly", () => {

    test("a sync method", () => {
        expect(() => mockOf(Upstream).label).toThrow(/Upstream\.label is not mockable: @mockable intercepts async methods only/)
    })

    test("a class without @mockable", () => {
        class Plain {
            async run(): Promise<void> {
            }
        }
        expect(() => mockOf(Plain).run).toThrow(/Plain\.run is not mockable: Plain has no @mockable/)
    })
})

describe("@mockable in production code", () => {

    test("keeps the class's name, statics and instanceof", () => {
        @mockable
        class Service {
            static readonly KIND = "service"
        }
        expect(Service.name).toBe("Service")
        expect(Service.KIND).toBe("service")
        expect(new Service()).toBeInstanceOf(Service)
    })

    test("constructs a frozen instance, leaving its fields as they are", async () => {
        @mockable
        class Frozen {
            run = async () => "real"

            constructor() {
                Object.freeze(this)
            }
        }
        expect(await new Frozen().run()).toBe("real")
    })
})

describe("mockOf's access object", () => {

    test("is not taken for a promise or broken by inspection", async () => {
        const access = mockOf(Upstream)
        expect(await Promise.resolve(access)).toBe(access)
        expect(String(access[Symbol.toStringTag as never])).toBe("undefined")
        expect(JSON.stringify(access)).toBe("{}")
    })

    test("still mocks a method named like a probed key", () => {
        @mockable
        class Deferred {
            async then(id: string): Promise<string> {
                return id
            }
        }
        expect(mockOf(Deferred).then.createInterceptor()).toBeDefined()
    })

    test("counts parameters around comments, so an only argument stays itself", async () => {
        const Commented = mockable(new Function(`return class Commented {
            async run(input /* org, not user */ // a, b
            ) {
                return input
            }
        }`)()) as new () => {run(input: {id: string}): Promise<unknown>}
        const interceptor = mockOf(Commented).run.toEqual({id: "a"}).createInterceptor() as GGCallInterceptor
        await expect(interceptor.onRequest({id: "a"})).resolves.toBeUndefined()
    })

    test("types an optional only argument as itself or undefined, and several as a tuple", () => {
        @mockable
        class Typed {
            async optional(_opts?: {x: number}): Promise<void> {
            }

            async several(_id: string, _count: number): Promise<void> {
            }
        }
        // @ts-expect-error not a field of the argument
        mockOf(Typed).optional.toMatchObject({y: 1})
        // @ts-expect-error the tuple's second item is a number
        mockOf(Typed).several.toEqual(["a", "b"])
        expect(() => mockOf(Typed).optional.toMatchObject({x: 1})).not.toThrow()
    })
})
