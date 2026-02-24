import type {TestDataDefinition} from "../../lib/TestRunner";

export const numberTestData: TestDataDefinition<number> = {
    category: "number",
    correctObj: 42 as any, // number is a special case
    wrongObj: "not a number",
    expectedErrorPaths: [""]  // Root level error
};
