import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/events",
    description: "Event-driven messaging for Grest Framework - SNS/SQS pub/sub pattern with type-safe contracts",
    keywords: ["events", "messaging", "pub-sub"],
    targets: {node: true},
    extendsTestKit: true
})
