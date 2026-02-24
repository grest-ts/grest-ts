import type {TestDataDefinition} from "../../lib/TestRunner";

export interface BigStringData {
    content: string;
    description: string;
    metadata: string;
}

const BIG_STRING_SIZE = 20_000;

function generateBigString(size: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ';
    let result = '';
    for (let i = 0; i < size; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Pre-generate big strings once
const pregenBigStrings = {
    content: generateBigString(BIG_STRING_SIZE),
    description: generateBigString(BIG_STRING_SIZE / 2),
    metadata: generateBigString(BIG_STRING_SIZE / 4)
};

export const bigStringTestData: TestDataDefinition<BigStringData> = {
    category: "bigString",
    correctObj: {
        content: pregenBigStrings.content,
        description: pregenBigStrings.description,
        metadata: pregenBigStrings.metadata,
        EXTRA: "should be stripped"
    } as BigStringData & { EXTRA?: string },
    wrongObj: {
        content: 12345, // Not a string
        description: pregenBigStrings.description,
        metadata: pregenBigStrings.metadata
    },
    expectedErrorPaths: ["content"]  // content wrong type
};
