import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/testkit",
    description: "Component testing library for @grest-ts",
    keywords: ["testing", "component-testing", "testkit"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    peerDependencies: {
        "esbuild": ">=0.27.0"
    }
})
