import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/logger-console",
    description: "Console logger implementation for @grest-ts/logger",
    publishToNpm: true,
    keywords: ["logging", "console", "logger"],
    targets: {node: true},
    implementationFor: "@grest-ts/logger"
})
