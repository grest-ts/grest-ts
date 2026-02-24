import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/discovery-migration",
    description: "Migration service discovery implementation for Grest Framework",
    keywords: ["service-discovery", "migration"],
    targets: {node: true},
    implementationFor: "@grest-ts/package"
})
