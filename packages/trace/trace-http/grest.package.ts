import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/trace-http",
    description: "Tracing support for GGContext",
    keywords: ["tracing", "http", "observability"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true
})
