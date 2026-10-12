import {callOn, GGTest} from "@grest-ts/testkit"
import {InterceptorRuntime} from "../src/InterceptorRuntime"
import {InterceptorApi} from "../src/api/InterceptorApi"

describe("server call interceptors", () => {

    GGTest.startInline(InterceptorRuntime)

    test("wrap the implementation, first registered outermost", async () => {
        expect(await callOn(InterceptorApi).plain({text: "hi"})).toBe("outer(inner(hi))")
    })

    test("see the method meta and can replace the input", async () => {
        expect(await callOn(InterceptorApi).shout({text: "hi"})).toBe("outer(inner(HI))")
    })

    test("can reject the call", async () => {
        await expect(callOn(InterceptorApi).denied({text: "hi"})).rejects.toThrow(/FORBIDDEN/)
    })
})
