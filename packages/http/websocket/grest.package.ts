import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/websocket",
    description: "WebSocket server and client library for Node.js and browser",
    publishToNpm: true,
    keywords: ["websocket", "realtime", "ws"],
    targets: {node: true, browser: true},
    extendsTestKit: true,
    peerDependencies: {
        "ws": "^8.19.0"
    }
})
