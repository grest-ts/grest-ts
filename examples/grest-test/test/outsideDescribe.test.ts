import {describe as vitestDescribe, test as vitestTest, expect} from "vitest"
import {GGTest} from "@grest-ts/testkit"
import {SubRuntime} from "../src/sub"

vitestDescribe("GGTest under vitest's own describe", () => {
    vitestTest("says why there is no runner", () => {
        expect(() => GGTest.startInline(SubRuntime)).toThrow(/imports `describe` or a hook .* from "vitest"/)
    })

    vitestTest("says when the setup file isn't loaded", () => {
        const loaded = Symbol.for("@grest-ts/testkit:GGDateShim")
        const g = globalThis as any
        const mark = g[loaded]
        delete g[loaded]
        try {
            expect(() => GGTest.startInline(SubRuntime)).toThrow(/setupFiles: \["@grest-ts\/testkit-vitest"\]/)
        } finally {
            g[loaded] = mark
        }
    })
})
