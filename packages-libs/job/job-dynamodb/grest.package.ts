import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/job-dynamodb",
    description: "DynamoDB lock for @grest-ts/job",
    keywords: ["job", "dynamodb", "aws", "distributed-lock"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    implementationFor: "@grest-ts/job",
    dependencies: {
        "@aws-sdk/client-dynamodb": "^3.750.0",
        "@aws-sdk/lib-dynamodb": "^3.750.0"
    }
})
