import type {TestDataDefinition} from "../../lib/TestRunner";

export interface RecursiveData {
    name: string;
    value: number;
    children?: RecursiveData[];
}

export const recursiveTestData: TestDataDefinition<RecursiveData> = {
    category: "recursive",
    correctObj: {
        name: 'root',
        value: 1,
        children: [
            {
                name: 'child1',
                value: 2,
                children: [
                    {name: 'grandchild1', value: 3},
                    {name: 'grandchild2', value: 4}
                ]
            },
            {
                name: 'child2',
                value: 5,
                children: [
                    {name: 'grandchild3', value: 6}
                ]
            }
        ],
        EXTRA: "should be stripped"
    } as RecursiveData & { EXTRA?: string },
    wrongObj: {
        name: 'root',
        value: 'not-a-number',
        children: [
            {name: 'child', value: 1}
        ]
    },
    expectedErrorPaths: ["value"]  // root.value wrong type
};
