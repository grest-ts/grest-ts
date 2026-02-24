import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/context",
    description: "Hierarchical async context",
    publishToNpm: true,
    keywords: ["context", "async-context", "dependency-injection"],
    targets: {node: true, browser: true},
    hasTests: true,
    allowedPackages: ["@grest-ts/schema", "@grest-ts/common"]
})
