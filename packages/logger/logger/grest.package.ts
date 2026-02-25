import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/logger",
    description: "Basic logging library to standardize logging over GG projects",
    publishToNpm: true,
    keywords: ["logging", "logger"],
    targets: { node: true, browser: true },
    extendsTestKit: true
})
