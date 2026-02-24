import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/config-aws",
    description: "AWS Secrets Manager adapter for @grest-ts/config",
    publishToNpm: true,
    keywords: ["configuration", "aws", "secrets-manager"],
    targets: {node: true},
    implementationFor: "@grest-ts/config",
    dependencies: {
        "@aws-sdk/client-secrets-manager": "^3.991.0"
    }
})
