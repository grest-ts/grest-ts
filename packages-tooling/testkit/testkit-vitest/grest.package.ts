import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/testkit-vitest",
    description: "Component testing library integration for vitest",
    keywords: ["testing", "vitest", "testkit"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    customExports: {
        "./globalSetup": "./src/globalSetup.ts"
    }
})
