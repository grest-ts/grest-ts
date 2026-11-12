import {describe as vitestDescribe, test as vitestTest, expect} from "vitest"
import {GGTest} from "@grest-ts/testkit"
import {SubRuntime} from "../src/sub"

vitestDescribe("GGTest under vitest's own describe", () => {
    vitestTest("says why there is no runner", () => {
        expect(() => GGTest.startInline(SubRuntime)).toThrow(/imports `describe` or a hook .* from "vitest"/)
    })
})
