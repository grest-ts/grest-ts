import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/code-generator",
    description: "TypeScript code generator for type-safe HTTP/WebSocket clients and servers",
    keywords: ["code-generation", "client", "server"],
    hidden: true,
    targets: {node: true},
    hasTests: true,
    references: ["http"],  // Used in generated code paths, not direct imports
    bin: {
        "grest": "./bin/grest.cjs"
    },
    dependencies: {
        "fast-glob": "^3.3.3"
    },
    vitestConfig: {
        test: {
            pool: "forks",
            fileParallelism: false,
            maxConcurrency: 1,
            sequence: {
                concurrent: false,
                groupOrder: 1
            },
            isolate: false,
            typecheck: {
                enabled: false
            }
        }
    }
})
