#!/usr/bin/env node

import {register} from 'tsx/esm/api'

// Register tsx to handle .ts files
register()

const { GGPackager } = await import("../src/index-node.ts")

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run") || args.includes("-d")
const help = args.includes("--help") || args.includes("-h")
const tsconfigOnly = args.includes("--tsconfig")
const packageOnly = args.includes("--package")

if (help) {
    console.log(`
grest-packager - Generate tsconfig.json and package.json files for grest packages

Usage: grest-packager [options]

Options:
  -d, --dry-run   Preview files without writing
  --tsconfig      Generate only tsconfig.json files
  --package       Generate only package.json files
  -h, --help      Show this help message

Examples:
  grest-packager                 # Generate all files
  grest-packager --dry-run       # Preview what would be generated
  grest-packager --tsconfig      # Generate only tsconfig files
`)
    process.exit(0)
}

try {
    await GGPackager.run({
        rootDir: process.cwd(),
        tsconfig: !packageOnly,
        packageJson: !tsconfigOnly,
        dryRun
    })
} catch (error) {
    console.error("❌ Error:", error.message)
    process.exit(1)
}
