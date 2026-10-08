import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/struct",
    description: "Binary struct definitions with code generation",
    keywords: ["binary", "struct", "serialization", "code-generation"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    dependencies: {
        "tinyglobby": "^0.2.17",
        "ts-morph": "^28.0.0"
    }
})
