import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/testkit-runtime",
    description: "Component testing library runtime code. ",
    keywords: ["testing", "runtime", "testkit"],
    targets: {node: true},
    publishToNpm: true,
    allowedPackages: ["@grest-ts/locator"]
})
