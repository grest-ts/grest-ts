import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/locator",
    description: "Hierarchical async context with tree-based inheritance",
    publishToNpm: true,
    keywords: ["service-locator", "dependency-injection", "async-context"],
    targets: {node: true},
    hasTests: true,
    allowedPackages: ["@grest-ts/common"]
})
