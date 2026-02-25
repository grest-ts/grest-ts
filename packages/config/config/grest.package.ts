import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/config",
    description: "Configuration management for Grest Framework - resources, secrets, and settings",
    publishToNpm: true,
    keywords: ["configuration", "secrets", "settings"],
    targets: {node: true},
    extendsTestKit: true,
    allowedPackages: ["@grest-ts/common", "@grest-ts/schema", "@grest-ts/locator"]
})
