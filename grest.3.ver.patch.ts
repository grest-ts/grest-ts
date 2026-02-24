// Bumps the patch version in root package.json.
// Run grest.check.ts afterwards to propagate to all workspace packages.
// Usage: tsx grest.ver.ts
import {readFileSync, writeFileSync} from "fs"
import {join, resolve} from "path"
import {execSync} from "child_process";

const ROOT = resolve(import.meta.dirname)
const rootPkgPath = join(ROOT, "package.json")
const rootPkgJson = JSON.parse(readFileSync(rootPkgPath, "utf-8"))

const oldVersion = rootPkgJson.version
const parts = oldVersion.split(".")
parts[2] = String(Number(parts[2]) + 1)
const newVersion = parts.join(".")

rootPkgJson.version = newVersion
writeFileSync(rootPkgPath, JSON.stringify(rootPkgJson, null, 2) + "\n")

// Regenerate all workspace package.json files to pick up the new version
execSync("npm run generate", {stdio: "inherit", cwd: ROOT, timeout: 20000})

console.log(`Version: ${oldVersion} -> ${newVersion}`)
