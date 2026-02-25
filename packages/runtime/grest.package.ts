import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/runtime",
    description: "Service bootstrap and lifecycle management utilities",
    publishToNpm: true,
    keywords: ["runtime", "bootstrap", "lifecycle"],
    targets: { node: true },
    references: ["discovery-local"]
})
