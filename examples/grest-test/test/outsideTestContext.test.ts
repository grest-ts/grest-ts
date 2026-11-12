import {afterAll as vitestAfterAll} from "vitest"
import {callOn, GGTest} from "@grest-ts/testkit"
import {MockableRuntime} from "../src/MockableRuntime"
import {MockableApi} from "../src/api/MockableApi"

describe("a test call outside the testkit's context", () => {
    GGTest.startWorker(MockableRuntime)
    const client = callOn(MockableApi)

    vitestAfterAll(async () => {
        await expect(client.named({id: "a"})).rejects.toThrow(/outside the testkit's context.*import \{afterEach\} from "vitest"/)
    })

    test("works inside it", async () => {
        await client.named({id: "a"}).toEqual("real:a")
    })
})
