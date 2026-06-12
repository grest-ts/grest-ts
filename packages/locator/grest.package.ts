import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/locator",
    description: "Hierarchical async context with tree-based inheritance",
    publishToNpm: true,
    keywords: ["service-locator", "dependency-injection", "async-context"],
    targets: {node: true, browser: true},
    hasTests: true,
    allowedPackages: ["@grest-ts/common"]
})
