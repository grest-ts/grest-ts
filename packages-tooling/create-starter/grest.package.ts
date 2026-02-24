import {definePackage} from "@grest-ts/x-packager"

definePackage({
    name: "@grest-ts/create-starter",
    description: "Scaffold a new grest-ts project",
    publishToNpm: true,
    targets: {},
    keywords: ["grest-ts", "create", "scaffold", "starter"],
    noSourceCode: {
        bin: "./index.mjs",
        files: [
            "index.mjs",
            "template"
        ],
    }
})
