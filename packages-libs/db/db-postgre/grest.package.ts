import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/db-postgre",
    description: "PostgreSQL database utilities for Grest Framework",
    keywords: ["database", "postgresql", "sql"],
    targets: { node: true },
    extendsTestKit: true,
    publishToNpm: true,
    dependencies: {
        "pg": "^8.18.0"
    },
    devDependencies: {
        "@types/pg": "^8.16.0"
    }
})
