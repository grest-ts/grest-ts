import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/events-azure",
    description: "Azure Service Bus adapter for @grest-ts/events",
    keywords: ["events", "azure", "service-bus"],
    targets: {node: true},
    implementationFor: "@grest-ts/events",
    dependencies: {
        "@azure/service-bus": "^7.9.5"
    }
})
