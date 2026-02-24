import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/common",
    description: "Common utility functions and types shared across all GG packages",
    publishToNpm: true,
    keywords: ["utilities", "shared", "helpers"],
    targets: {node: true, browser: true},
    allowedPackages: [],
    dependencies: {
        "fast-glob": "^3.3.3"
    }
})
