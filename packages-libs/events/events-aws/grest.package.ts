import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/events-aws",
    description: "AWS SNS/SQS adapter for @grest-ts/events",
    keywords: ["events", "aws", "sns", "sqs"],
    targets: {node: true},
    implementationFor: "@grest-ts/events",
    dependencies: {
        "@aws-sdk/client-sns": "^3.991.0",
        "@aws-sdk/client-sqs": "^3.991.0"
    }
})
