import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/lock",
    description: "Distributed lock interface and implementations for Grest Framework",
    keywords: ["distributed-lock", "locking", "concurrency"],
    targets: { node: true },
    hasTests: true
})
