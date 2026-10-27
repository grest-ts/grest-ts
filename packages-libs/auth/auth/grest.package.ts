import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/auth",
    description: "Authentication library for Node.js and browser — JWT signing, IdP strategies, HTTP/WS guards, and client-side session management",
    keywords: ["auth", "jwt", "authentication", "session", "idp"],
    targets: {node: true, browser: true},
    publishToNpm: true,
    hasTests: true,
    dependencies: {
        "jose": "^6.2.12",
        "openid-client": "6.8.8",
    },
    peerDependencies: {
        "bcrypt": "^6.0.0",
    },
    devDependencies: {
        "@types/bcrypt": "^6.0.0",
    },
    customExports: {
        "./oidc-rp": "./src/node/idp/OidcRelyingParty.ts",
    },
})
