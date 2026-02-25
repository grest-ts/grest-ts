import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/ipc",
    description: "Service internal process communications library. For local testing only.",
    publishToNpm: true,
    keywords: ["ipc", "inter-process-communication", "proxy"],
    targets: { node: true },
    dependencies: {
        "find-my-way": "^9.4.0",
        "http-proxy": "^1.18.1",
        "ws": "^8.19.0"
    },
    devDependencies: {
        "@types/http-proxy": "^1.17.17"
    }
})
