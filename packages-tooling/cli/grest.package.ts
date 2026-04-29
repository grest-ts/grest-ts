import {definePackage} from "#scripts/packager/definePackage"

definePackage({
    name: "@grest-ts/cli",
    description: "CLI for managing grest-ts in a project (atomic version upgrades, etc.)",
    publishToNpm: true,
    targets: {},
    keywords: ["grest-ts", "cli", "upgrade", "tooling"],
    noSourceCode: {
        bin: "./index.mjs",
        files: [
            "index.mjs",
        ],
    }
})
