import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/service-auth",
    description: "Service-to-service authentication for grest-ts: a shared-secret header wire, verified fail-closed and in constant time",
    keywords: ["auth", "service-to-service", "shared-secret", "internal-api"],
    targets: {node: true},
    publishToNpm: true,
    hasTests: true,
})
