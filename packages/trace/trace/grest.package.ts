import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/trace",
    description: "Tracing support for GGContext",
    keywords: ["tracing", "observability", "distributed-tracing"],
    targets: {node: true, browser: true},
    hasTests: true,
    publishToNpm: true
})
