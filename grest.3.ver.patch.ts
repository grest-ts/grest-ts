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
const [major, minor, patch] = oldVersion.split(".")

// Resume from the highest already-tagged patch, not just package.json's.
// ci.yml pushes the v<version> tag before npm publish runs (publish.yml
// triggers on the tag), so a publish that failed after tagging leaves a tag
// with no npm release. Without this, every retry recomputes the same version
// and dies on `git tag: already exists`. Tags are a superset of npm versions
// (tag pushed first), so this also skips anything already on the registry.
let basePatch = Number(patch)
try {
    const prefix = `v${major}.${minor}.`
    for (const tag of execSync("git tag -l", {cwd: ROOT, encoding: "utf-8"}).split("\n")) {
        if (!tag.startsWith(prefix)) continue
        const tagged = Number(tag.slice(prefix.length))
        if (Number.isInteger(tagged) && tagged > basePatch) basePatch = tagged
    }
} catch {
    // No git tags available — fall back to the package.json version.
}

const newVersion = `${major}.${minor}.${basePatch + 1}`

rootPkgJson.version = newVersion
writeFileSync(rootPkgPath, JSON.stringify(rootPkgJson, null, 2) + "\n")

// Regenerate all workspace package.json files to pick up the new version
execSync("npm run generate", {stdio: "inherit", cwd: ROOT, timeout: 20000})

console.log(`Version: ${oldVersion} -> ${newVersion}`)
