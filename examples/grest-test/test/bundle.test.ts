import {GGBundleTest} from "@grest-ts/testkit";

GGBundleTest.verify({
    entryPoint: import.meta.resolve('../src/main.ts'),
});
