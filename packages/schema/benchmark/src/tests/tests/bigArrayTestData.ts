import type {TestDataDefinition} from "../../lib/TestRunner";

export interface BigArrayData {
    items: Array<{ id: number; name: string; value: number }>;
}

const BIG_ARRAY_SIZE = 1000;

function generateBigArray(size: number): Array<{ id: number; name: string; value: number; EXTRA?: string }> {
    const items: Array<{ id: number; name: string; value: number; EXTRA?: string }> = [];
    for (let i = 0; i < size; i++) {
        items.push({
            id: i,
            name: `item_${i}`,
            value: Math.random() * 1000,
            EXTRA: "strip_me"  // Each item has EXTRA to test stripping at scale
        });
    }
    return items;
}

const pregenBigArray = generateBigArray(BIG_ARRAY_SIZE);
const pregenWrongArray = [...pregenBigArray.slice(0, -1), {id: "wrong", name: 123, value: "bad", EXTRA: "strip_me"}];

export const bigArrayTestData: TestDataDefinition<BigArrayData> = {
    category: "bigArray",
    correctObj: {
        items: pregenBigArray,
        EXTRA: "should be stripped"
    } as BigArrayData & { EXTRA?: string },
    wrongObj: {
        items: pregenWrongArray
    },
    expectedErrorPaths: ["items.999.id", "items.999.name", "items.999.value"]  // last item: id, name, value wrong types
};
