import {describe, it, expect} from "vitest";
import {GGIssueKey} from "./GGIssueKey";
import {GGIssuesList} from "./GGIssuesList";

// Define all test issues once at module load time to avoid registry conflicts
const TestIssues = {
    code: new GGIssueKey("spec.test.code", "Test message"),
    range: new GGIssueKey<{ min: number; max: number }>(
        "spec.test.range",
        "Value must be between {min} and {max}",
        {min: "Minimum value", max: "Maximum value"}
    ),
    required: new GGIssueKey("spec.test.required", "Value is required"),
    min: new GGIssueKey<{ min: number }>(
        "spec.test.min",
        "Minimum {min} required",
        {min: "Minimum value"}
    ),
    simple: new GGIssueKey("spec.test.simple", "Simple message"),
    parameterized: new GGIssueKey<{ name: string; count: number }>(
        "spec.test.parameterized",
        "Hello {name}, you have {count} items",
        {name: "User name", count: "Item count"}
    ),
    plural: new GGIssueKey<{ count: number }>(
        "spec.test.plural",
        "{count, plural, one {# item} other {# items}}",
        {count: "Number of items"}
    ),
    toJsonMin: new GGIssueKey<{ min: number }>(
        "spec.test.tojson.min",
        "Minimum {min}",
        {min: "Minimum value"}
    )
};

describe("GGIssue", () => {

    describe("constructor", () => {
        it("should create issue without params", () => {
            expect(TestIssues.code.code).toBe("spec.test.code");
            expect(TestIssues.code.message).toBe("Test message");
            expect(TestIssues.code.paramDescriptions).toBeUndefined();
        });

        it("should create issue with params", () => {
            expect(TestIssues.range.code).toBe("spec.test.range");
            expect(TestIssues.range.message).toBe("Value must be between {min} and {max}");
            expect(TestIssues.range.paramDescriptions).toEqual({min: "Minimum value", max: "Maximum value"});
        });
    });

    describe("add()", () => {
        it("should add issue without params to issues list", () => {
            const issues = new GGIssuesList();
            const result = TestIssues.required.add("test", issues, "field");

            expect(result).toBe(false);
            expect(issues.length).toBe(1);
            expect(issues.getIssue(0)?.code).toBe("spec.test.required");
        });

        it("should add issue with params to issues list", () => {
            const issues = new GGIssuesList();
            const result = TestIssues.min.add("test", issues, "field", {min: 5});

            expect(result).toBe(false);
            expect(issues.length).toBe(1);
            expect(issues.getIssue(0)?.code).toBe("spec.test.min");
            expect(issues.getParams(0)).toEqual({min: 5});
        });
    });

    describe("toJSON()", () => {
        it("should serialize issue without params", () => {
            expect(TestIssues.code.toJSON()).toEqual({
                code: "spec.test.code",
                message: "Test message",
                params: undefined
            });
        });

        it("should serialize issue with params", () => {
            expect(TestIssues.toJsonMin.toJSON()).toEqual({
                code: "spec.test.tojson.min",
                message: "Minimum {min}",
                params: {min: "Minimum value"}
            });
        });
    });

    describe("static required", () => {
        it("should have static required issue", () => {
            expect(GGIssueKey.required.code).toBe("required");
            expect(GGIssueKey.required.message).toBe("Value is required");
        });
    });
});
