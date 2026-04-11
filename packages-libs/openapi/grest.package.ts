import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/openapi",
    description: "OpenAPI 3.1 spec generation and Swagger UI server for grest-ts",
    keywords: ["openapi", "swagger", "api-docs", "openapi3"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    dependencies: {
        "openapi-types": "^12.1.3",
        "swagger-ui-dist": "^5.32.2"
    }
})
