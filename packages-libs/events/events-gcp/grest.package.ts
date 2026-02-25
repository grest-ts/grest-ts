import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/events-gcp",
    description: "Google Cloud Pub/Sub adapter for @grest-ts/events",
    keywords: ["events", "gcp", "pub-sub", "google-cloud"],
    targets: {node: true},
    implementationFor: "@grest-ts/events",
    dependencies: {
        "@google-cloud/pubsub": "^5.2.3"
    }
})
