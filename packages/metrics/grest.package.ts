import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/metrics",
    description: "Metrics library for Grest Framework",
    publishToNpm: true,
    keywords: ["metrics", "monitoring", "observability"],
    targets: {node: true},
    extendsTestKit: true,
    allowedPackages: ["@grest-ts/common", "@grest-ts/locator", "@grest-ts/testkit"]
})
