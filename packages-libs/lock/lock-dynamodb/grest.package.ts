import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/lock-dynamodb",
    description: "DynamoDB implementation of GGLock, for locks shared across instances",
    keywords: ["distributed-lock", "locking", "dynamodb", "aws"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    implementationFor: "@grest-ts/lock",
    dependencies: {
        "@aws-sdk/client-dynamodb": "^3.750.0"
    }
})
