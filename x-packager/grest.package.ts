import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/x-packager",
    description: "Package and tsconfig utility for grest framework. Makes framework dependency management automatic and easy.",
    keywords: ["packager", "monorepo", "tooling"],
    targets: {node: true},
    bin: {
        "grest-packager": "./bin/grest-packager.mjs"
    },
    dependencies: {
        "fast-glob": "^3.3.3"
    }
})
