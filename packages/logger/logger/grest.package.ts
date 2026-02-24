import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/logger",
    description: "Basic logging library to standardize logging over GG projects",
    publishToNpm: true,
    keywords: ["logging", "logger"],
    targets: { node: true, browser: true },
    extendsTestKit: true
})
