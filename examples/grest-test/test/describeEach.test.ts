import {GG_TEST_RUNNER, GGTest, GGTestRunner} from "@grest-ts/testkit";
import {SubRuntime} from "../src/sub";

const runners = new Map<string, GGTestRunner>();

describe.each(["a", "b"])("describe.each %s", (name) => {
    GGTest.startInline(SubRuntime);
    test("records its runner", () => {
        runners.set("each " + name, GG_TEST_RUNNER.get());
    });
});

describe.for(["a", "b"])("describe.for %s", (name) => {
    test("records its runner", () => {
        runners.set("for " + name, GG_TEST_RUNNER.get());
    });
});

describe("parent", () => {
    test("records its runner", () => {
        runners.set("parent", GG_TEST_RUNNER.get());
    });
    describe.each(["a", "b"])("nested %s", (name) => {
        test("records its runner", () => {
            runners.set("nested " + name, GG_TEST_RUNNER.get());
        });
    });
});

describe("test.for", () => {
    test.for([1, 2])("runs case %s in the runner's scope", (n) => {
        expect(GG_TEST_RUNNER.get()).toBeDefined();
        expect(n).toBeGreaterThan(0);
    });
});

describe("runners", () => {
    test("each top-level case gets its own runner; nested cases share the parent's", () => {
        expect([...runners.keys()].sort()).toEqual(["each a", "each b", "for a", "for b", "nested a", "nested b", "parent"]);
        expect(new Set(["each a", "each b", "for a", "for b", "parent"].map(k => runners.get(k))).size).toBe(5);
        expect(runners.get("nested a")).toBe(runners.get("parent"));
        expect(runners.get("nested b")).toBe(runners.get("parent"));
    });
});
