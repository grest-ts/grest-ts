import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/db-mysql",
    description: "MySQL database utilities for Grest Framework",
    keywords: ["database", "mysql", "sql"],
    targets: { node: true },
    extendsTestKit: true,
    publishToNpm: true,
    dependencies: {
        "mysql2": "^3.17.2"
    }
})
