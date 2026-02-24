import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/runtime",
    description: "Service bootstrap and lifecycle management utilities",
    publishToNpm: true,
    keywords: ["runtime", "bootstrap", "lifecycle"],
    targets: { node: true },
    references: ["discovery-local"]
})
