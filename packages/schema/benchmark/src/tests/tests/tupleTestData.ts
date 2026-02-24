import type {TestDataDefinition} from "../../lib/TestRunner";

export interface TupleData {
    coords: [number, number, number];
    range: [number, number];
    mixed: [string, number, boolean];
}

export const tupleTestData: TestDataDefinition<TupleData> = {
    category: "tuple",
    correctObj: {
        coords: [10.5, 20.3, 30.1],
        range: [0, 100],
        mixed: ['hello', 42, true],
        EXTRA: "should be stripped"
    } as TupleData & { EXTRA?: string },
    wrongObj: {
        coords: [10.5, 20.3], // Missing element
        range: [0, 'hundred'], // Wrong type
        mixed: ['hello', 42, 'not-boolean']
    },
    expectedErrorPaths: ["coords", "range.1", "mixed.2"]  // coords length, range[1], mixed[2]
};
