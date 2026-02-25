import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/http",
    description: "HTTP server and client library for Node.js and browser",
    publishToNpm: true,
    keywords: ["http", "server", "client", "rest"],
    targets: {node: true, browser: true},
    extendsTestKit: true,
    dependencies: {
        "find-my-way": "^9.4.0"
    }
})
