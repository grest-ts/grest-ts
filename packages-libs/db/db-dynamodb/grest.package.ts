import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/db-dynamodb",
    description: "DynamoDB database utilities for Grest Framework",
    keywords: ["database", "dynamodb", "aws", "nosql"],
    targets: { node: true },
    extendsTestKit: true,
    publishToNpm: true,
    dependencies: {
        "@aws-sdk/client-dynamodb": "^3.750.0",
        "@aws-sdk/lib-dynamodb": "^3.750.0"
    }
})
