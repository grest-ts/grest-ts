import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/authz",
    description: "Authorization engine for hierarchical resources — IAM-style deny/cap/grant evaluation, contract requirements, list plans and approvals",
    keywords: ["authz", "authorization", "iam", "rbac", "abac", "policy", "permissions"],
    targets: {node: true, browser: true},
    publishToNpm: true,
    hasTests: true,
    allowedPackages: ["@grest-ts/common", "@grest-ts/context", "@grest-ts/schema"],
    devDependencies: {
        "@cedar-policy/cedar-wasm": "4.14.0",
    },
    scripts: {
        "test:cedar": "GG_AUTHZ_CEDAR=1 vitest run test/cedar.test.ts",
        "bench": "tsx test/bench.ts",
    },
})
