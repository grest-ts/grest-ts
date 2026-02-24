import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/discovery-static",
    description: "Static service discovery implementation for Grest Framework",
    publishToNpm: true,
    keywords: ["service-discovery", "static", "configuration"],
    targets: {node: true},
    implementationFor: "@grest-ts/package"
})
