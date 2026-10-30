import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/oauth",
    description: "OAuth 2.1 authorization server (panva oidc-provider on GGHttpServer) issuing @grest-ts/auth tokens, plus a browser code+PKCE client for GGAuthSession",
    keywords: ["auth", "oauth", "oauth2", "oidc", "pkce", "mcp"],
    targets: {node: true, browser: true},
    publishToNpm: true,
    hasTests: true,
    extendsTestKit: true,
    dependencies: {
        "jose": "^6.2.12",
        "oidc-provider": "9.13.0",
        "@types/oidc-provider": "9.12.1",
    },
    customExports: {
        "./dynamodb": "./src/node/store/DynamoOAuthStore.ts",
    },
})
