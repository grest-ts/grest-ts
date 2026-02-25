import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/file-http",
    description: "HTTP file download codec for Grest framework",
    publishToNpm: true,
    keywords: ["http", "file", "upload", "download"],
    targets: {node: true, browser: true},
    dependencies: {
        "busboy": "^1.6.0",
    },
    devDependencies: {
        "@types/busboy": "^1.5.4"
    }
})
