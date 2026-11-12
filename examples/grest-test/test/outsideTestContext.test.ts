import {afterAll as vitestAfterAll} from "vitest"
import {callOn, GGTest} from "@grest-ts/testkit"
import {MockableRuntime} from "../src/MockableRuntime"
import {MockableApi} from "../src/api/MockableApi"

describe("a test call outside the testkit's context", () => {
    GGTest.startWorker(MockableRuntime)
    const client = callOn(MockableApi)

    vitestAfterAll(async () => {
        await expect(client.named({id: "a"})).rejects.toThrow(/No GGTest runner here.*a hook \(`afterEach`, …\)/)
    })

    test("works inside it", async () => {
        await client.named({id: "a"}).toEqual("real:a")
    })
})

describe("a hook or test that returns a test call without awaiting it", () => {
    GGTest.startWorker(MockableRuntime)
    const client = callOn(MockableApi)

    describe("nested", () => {
        beforeAll(() => client.named({id: "a"}).toEqual("real:a"))
        afterAll(() => client.named({id: "a"}).toEqual("real:a"))

        test("runs it inside the context", () => client.named({id: "a"}).toEqual("real:a"))
    })
})
