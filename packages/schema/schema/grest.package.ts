import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/schema",
    description: "Type-safe schema validation, serialization, and contract definitions for TypeScript",
    publishToNpm: true,
    keywords: ["schema", "validation", "serialization", "type-safe"],
    targets: {node: true, browser: true},
    hasTests: true,
    allowedPackages: [] // Do not add packages here!
})
