import {GGSharedSecret} from "./GGSharedSecret"

describe("GGSharedSecret.equals", () => {
    test("compares content, not just length", () => {
        expect(GGSharedSecret.equals("abc", "abc")).toBe(true)
        expect(GGSharedSecret.equals("abc", "abd")).toBe(false)
        expect(GGSharedSecret.equals("abc", "abcd")).toBe(false)
        expect(GGSharedSecret.equals("", "")).toBe(true)
    })
})
