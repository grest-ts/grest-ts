import {describe, expect, test} from "vitest"
import {GGContextKey} from "./GGContextKey"
import {defineElsewhere} from "../test/defineElsewhere"

describe("a context key name", () => {
    test("can be defined in one file only", () => {
        new GGContextKey<string>("test-token", undefined as never)
        expect(() => defineElsewhere("test-token"))
            .toThrow(/'test-token' is defined twice: in .*GGContextKey\.test\.ts and in .*defineElsewhere\.ts\./)
    })

    test("defined again from the same file is that module evaluated again", () => {
        new GGContextKey<string>("test-reloaded", undefined as never)
        expect(new GGContextKey<string>("test-reloaded", undefined as never).name).toBe("test-reloaded")
    })

    test("is defined where a subclass is constructed, not in the subclass's file", () => {
        class TestHeader extends GGContextKey<string> {
            constructor(name: string) {
                super(name, undefined as never)
            }
        }
        defineElsewhere("test-header")
        expect(() => new TestHeader("test-header")).toThrow(/'test-header' is defined twice: in .*defineElsewhere\.ts and in .*GGContextKey\.test\.ts\./)
    })
})
