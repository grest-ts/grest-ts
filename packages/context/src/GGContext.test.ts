import {describe, expect, test} from "vitest"
import {GGContext} from "./GGContext"
import {GGContextKey} from "./GGContextKey"

const LOCALE = new GGContextKey<string>("test-locale", undefined as never)
const SPAN = new GGContextKey<string>("test-span", undefined as never, {mutable: true})

describe("a strict context", () => {
    test("sets a key once", () => {
        const ctx = new GGContext("unit", undefined, {strict: true})
        ctx.set(LOCALE, "en")
        expect(() => ctx.set(LOCALE, "de")).toThrow(/'test-locale' was already set in context 'unit'/)
        expect(ctx.get(LOCALE)).toBe("en")
    })

    test("a delete doesn't open the way to a second set", () => {
        const ctx = new GGContext("unit", undefined, {strict: true})
        ctx.set(LOCALE, "en")
        ctx.delete(LOCALE)
        expect(ctx.has(LOCALE)).toBe(false)
        expect(() => ctx.set(LOCALE, "de")).toThrow(/already set/)
    })

    test("reset starts it over", () => {
        const ctx = new GGContext("unit", undefined, {strict: true}).set(LOCALE, "en")
        ctx.reset()
        expect(ctx.set(LOCALE, "de").get(LOCALE)).toBe("de")
    })

    test("a mutable key changes freely", () => {
        const ctx = new GGContext("unit", undefined, {strict: true})
        ctx.set(SPAN, "a").set(SPAN, "b")
        expect(ctx.get(SPAN)).toBe("b")
    })

    test("its children are strict, and each can scope its own value", () => {
        const unit = new GGContext("unit", undefined, {strict: true}).set(LOCALE, "en")
        const child = new GGContext("child", unit).set(LOCALE, "de")
        expect(child.get(LOCALE)).toBe("de")
        expect(() => child.set(LOCALE, "fr")).toThrow(/already set in context 'child'/)
        expect(() => new GGContext("grandchild", child).set(LOCALE, "fr").set(LOCALE, "et")).toThrow(/'grandchild'/)
    })
})

test("a non-strict root and its children update values in place", () => {
    const session = new GGContext("session").set(LOCALE, "en").set(LOCALE, "de")
    const child = new GGContext("child", session).set(LOCALE, "fr").set(LOCALE, "et")
    expect([session.get(LOCALE), child.get(LOCALE)]).toEqual(["de", "et"])
})
