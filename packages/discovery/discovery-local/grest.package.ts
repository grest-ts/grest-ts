import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/discovery-local",
    description: "Local service discovery implementation for Grest Framework",
    publishToNpm: true,
    keywords: ["service-discovery", "local", "development"],
    targets: {node: true},
    extendsTestKit: true,
    implementationFor: "@grest-ts/package",
    dependencies: {
        "ws": "^8.19.0"
    }
})
