import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/discovery",
    description: "Service discovery implementations for Grest Framework",
    publishToNpm: true,
    keywords: ["service-discovery", "discovery"],
    targets: { node: true },
    extendsTestKit: true
})
