import {GGTest} from "@grest-ts/testkit"
import {AppRuntime} from "../../src/AppRuntime"
import {HelloApi} from "@newproject/api/api/HelloApi"
import {TestContext} from "../TestContext"

describe("Hello API", () => {

    GGTest.startWorker(AppRuntime)

    const ctx = new TestContext("Test")
        .apis({hello: HelloApi})

    test("hello returns greeting", async () => {
        await ctx.hello.hello({name: "World"})
            .toMatchObject({message: "Hello, World!"})
    })

    test("hello returns greeting with custom name", async () => {
        await ctx.hello.hello({name: "Alice"})
            .toMatchObject({message: "Hello, Alice!"})
    })
})
