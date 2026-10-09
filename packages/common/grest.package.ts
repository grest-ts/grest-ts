import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/common",
    description: "Common utility functions and types shared across all GG packages",
    publishToNpm: true,
    keywords: ["utilities", "shared", "helpers"],
    targets: {node: true, browser: true},
    hasTests: true,
    allowedPackages: [],
    dependencies: {
        "tinyglobby": "^0.2.17"
    }
})
