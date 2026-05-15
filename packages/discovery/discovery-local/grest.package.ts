import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/discovery-local",
    description: "Local service discovery implementation for Grest Framework",
    publishToNpm: true,
    keywords: ["service-discovery", "local", "development"],
    targets: {node: true},
    hasTests: true,
    extendsTestKit: true,
    implementationFor: "@grest-ts/package",
    bin: {
        "discovery-local": "./src/bin/discovery-local.ts"
    },
    dependencies: {
        "ws": "^8.19.0"
    }
})
