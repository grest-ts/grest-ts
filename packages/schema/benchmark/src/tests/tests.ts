import {TestCategory} from "../constants";
import {numberTestData} from "./tests/numberTestData";
import {simpleTestData} from "./tests/simpleTestData";
import {nestedTestData} from "./tests/nestedTestData";
import {refineTestData} from "./tests/refineTestData";
import {discriminatedTestData} from "./tests/discriminatedTestData";
import {recursiveTestData} from "./tests/recursiveTestData";
import {tupleTestData} from "./tests/tupleTestData";
import {bigStringTestData} from "./tests/bigStringTestData";
import {bigArrayTestData} from "./tests/bigArrayTestData";

// Note: Cannot freeze - some libraries (TypeBox) mutate objects during validation
export const TEST_DATA: Record<TestCategory, any> = {
    [TestCategory.number]: numberTestData,
    [TestCategory.simple]: simpleTestData,
    [TestCategory.nested]: nestedTestData,
    [TestCategory.refine]: refineTestData,
    [TestCategory.discriminated]: discriminatedTestData,
    [TestCategory.recursive]: recursiveTestData,
    [TestCategory.tuple]: tupleTestData,
    [TestCategory.bigString]: bigStringTestData,
    [TestCategory.bigArray]: bigArrayTestData,
};