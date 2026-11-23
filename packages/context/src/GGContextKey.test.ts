import {describe, expect, test} from "vitest"
import {GGContextKey} from "./GGContextKey"

describe("a context key name", () => {
    test("can be defined once", () => {
        new GGContextKey<string>("test-token", undefined as never)
        expect(() => new GGContextKey<string>("test-token", undefined as never))
            .toThrow(/'test-token' is defined twice: at .*GGContextKey\.test\.ts:\d+:\d+ and at .*GGContextKey\.test\.ts:\d+:\d+/)
    })

    test("defined again from the same place is the same key evaluated again", () => {
        const define = () => new GGContextKey<string>("test-reloaded", undefined as never)
        define()
        expect(define().name).toBe("test-reloaded")
    })

    test("is where a subclass is constructed, not the subclass's constructor", () => {
        class TestHeader extends GGContextKey<string> {
            constructor(name: string) {
                super(name, undefined as never)
            }
        }
        new TestHeader("test-header")
        expect(() => new TestHeader("test-header")).toThrow(/'test-header' is defined twice/)
    })
})
