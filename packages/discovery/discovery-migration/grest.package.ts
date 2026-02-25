import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/discovery-migration",
    description: "Migration service discovery implementation for Grest Framework",
    keywords: ["service-discovery", "migration"],
    targets: {node: true},
    implementationFor: "@grest-ts/package"
})
