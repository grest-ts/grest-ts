import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/sql",
    description: "Type-safe SQL query builder for MySQL",
    keywords: ["sql", "query-builder", "mysql"],
    targets: {node: true},
    publishToNpm: true,
    dependencies: {
        "sqlstring": "^2.3.3"
    },
    devDependencies: {
        "@types/sqlstring": "^2.3.2"
    }
})
