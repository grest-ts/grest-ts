import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/asyncapi",
    description: "AsyncAPI 3.0 spec generation for grest-ts WebSocket APIs",
    keywords: ["asyncapi", "websocket", "api-docs", "asyncapi3"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    dependencies: {}
})
