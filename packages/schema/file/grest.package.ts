import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/file",
    description: "File abstraction for Grest framework",
    publishToNpm: true,
    keywords: ["file", "abstraction", "binary"],
    targets: {node: true, browser: true},
    extendsTestKit: true
})
