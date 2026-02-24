// Config generation entry point: generates tsconfig.json, package.json,
// vitest workspace config, and dependency graph for all monorepo packages.
// Run via `npm run generate`.
import {definePackage} from "@grest-ts/x-packager"

definePackage({
    packages: ["packages", "packages-libs", "packages-tooling", "x-packager"],
    dependenciesGraphOut: "./docs/DEPENDENCIES.md",
    vitestWorkspaceExtraEntries: [
        'examples/checklist',
        'examples/grest-test'
    ]
})