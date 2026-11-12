import {callOn, GGCallInterceptor, GGTest, mockOf} from "@grest-ts/testkit"
import {mockable} from "@grest-ts/testkit-runtime"
import {SERVER_ERROR} from "@grest-ts/schema"
import {MockableRuntime} from "../src/MockableRuntime"
import {MockableApi} from "../src/api/MockableApi"
import {UPSTREAM_REFUSED, Upstream} from "../src/services/mockable/Upstream"

describe("mockOf on a @mockable class", () => {
    GGTest.startWorker(MockableRuntime)
    const client = callOn(MockableApi)

    describe("the input matchers and andReturn callbacks see", () => {

        test("a single object argument as itself", async () => {
            await client.lookup({id: "a"})
                .with(mockOf(Upstream).lookup.toEqual({id: "a"}).andReturn(input => "mocked:" + input.id))
                .toEqual("mocked:a")
        })

        test("a destructured single argument as itself", async () => {
            await client.tagged({id: "a", tag: "t"})
                .with(mockOf(Upstream).tagged.toEqual({id: "a", tag: "t"}).andReturn(({id, tag}) => `mocked:${id}:${tag}`))
                .toEqual("mocked:a:t")
        })

        test("several arguments keyed by parameter name", async () => {
            await client.pair({id: "a", count: 2})
                .with(mockOf(Upstream).pair.toEqual({id: "a", count: 2}).andReturn(({id, count}) => `mocked:${id}x${count}`))
                .toEqual("mocked:ax2")
        })

        test("a single primitive argument keyed by parameter name", async () => {
            await client.named({id: "a"})
                .with(mockOf(Upstream).named.toEqual({id: "a"}).andReturn(({id}) => "mocked:" + id))
                .toEqual("mocked:a")
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
            .with(mockOf(Upstream).named.andReturn(async ({id}) => {
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
            for (let i = 0; i < 3; i++) await interceptor.onRequest({id: "a"})
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

    test("a method declared as a class field", () => {
        expect(() => mockOf(Upstream).field).toThrow(/Upstream\.field is not mockable/)
    })

    test("a class without @mockable", () => {
        class Plain {
            async run(): Promise<void> {
            }
        }
        expect(() => mockOf(Plain).run).toThrow(/Plain\.run is not mockable/)
    })

    test("a method with a destructured parameter among several: mocks can't name its arguments", () => {
        @mockable
        class Broken {
            async run(id: string, {tag}: {tag: string}): Promise<string> {
                return id + tag
            }
        }
        expect(() => mockOf(Broken).run).toThrow(/Broken\.run can't be mocked/)
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

    test("reads parameter names around comments", () => {
        const Commented = mockable(new Function(`return class Commented {
            async run(id /* org, not user */, // a, b
                      count) {
                return id + count
            }
        }`)()) as new () => {run(id: string, count: number): Promise<string>}
        expect(() => mockOf(Commented).run).not.toThrow()
    })

    test("types a single optional object parameter as the object", () => {
        @mockable
        class Optional {
            async run(_opts?: {x: number}): Promise<void> {
            }
        }
        // @ts-expect-error not a field of the argument
        mockOf(Optional).run.toMatchObject({y: 1})
        expect(() => mockOf(Optional).run.toMatchObject({x: 1})).not.toThrow()
    })
})
