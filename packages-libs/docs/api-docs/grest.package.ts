import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/api-docs",
    description: "Unified HTTP + WebSocket API documentation UI for grest-ts",
    keywords: ["api-docs", "openapi", "asyncapi", "swagger", "documentation"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    dependencies: {
        "@asyncapi/react-component": "^2.5.0"
    }
})
