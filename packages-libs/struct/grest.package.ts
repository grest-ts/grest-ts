import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/struct",
    description: "Binary struct definitions with code generation",
    keywords: ["binary", "struct", "serialization", "code-generation"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    dependencies: {
        "fast-glob": "^3.3.3",
        "ts-morph": "^27.0.2"
    }
})
