import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/testkit-runtime",
    description: "Component testing library runtime code. ",
    keywords: ["testing", "runtime", "testkit"],
    targets: {node: true},
    publishToNpm: true,
    allowedPackages: ["@grest-ts/locator"]
})
