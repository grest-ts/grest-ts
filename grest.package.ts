// Config generation entry point: generates tsconfig.json, package.json,
// vitest workspace config, and dependency graph for all monorepo packages.
// Run via `npm run generate`.
import {definePackage} from "#scripts/packager/definePackage"

definePackage({
    packages: ["packages", "packages-libs", "packages-tooling"],
    dependenciesGraphOut: "./docs/DEPENDENCIES.md",
    vitestWorkspaceExtraEntries: [
        'examples/checklist',
        'examples/grest-test',
        'examples/auth/server'
    ],
    workspaceExtraEntries: [
        'examples/auth/client',
        'docs-web',
        'packages-tooling/create-starter/template/api',
        'packages-tooling/create-starter/template/server',
        'packages-tooling/create-starter/template/client',
        'examples/api-docs-v2',
        'examples/api-docs-v2/ui'
    ]
})