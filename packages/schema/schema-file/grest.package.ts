import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/schema-file",
    description: "File abstraction for Grest framework",
    publishToNpm: true,
    keywords: ["file", "abstraction", "binary"],
    targets: {node: true, browser: true},
    extendsTestKit: true
})
