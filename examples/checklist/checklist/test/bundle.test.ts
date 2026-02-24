import {GGBundleTest} from "@grest-ts/testkit";

GGBundleTest.verify({
    entryPoint: import.meta.resolve('../checklist.ts'),
});
