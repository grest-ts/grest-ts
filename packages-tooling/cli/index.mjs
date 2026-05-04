#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, rmSync } from "fs"
import { join, resolve, dirname } from "path"
import { spawnSync } from "child_process"

const GREST_PREFIX = "@grest-ts/"
const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies"]

const COMMANDS = {
  update: runUpdate,
  help: runHelp,
}

async function main() {
  const [, , cmd, ...args] = process.argv

  if (!cmd || cmd === "--help" || cmd === "-h") {
    runHelp()
    process.exit(0)
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    console.error(`Unknown command: ${cmd}\n`)
    runHelp()
    process.exit(1)
  }

  await handler(args)
}

function runHelp() {
  console.log(`grest-ts CLI

Usage:
  grest-ts <command> [options]

Commands:
  update [version]    Atomically update all @grest-ts/* deps to a single version.
                      Version can be a semver (e.g. 0.0.30) or a dist-tag
                      (latest, next). Defaults to "latest". Also walks the
                      published peer-dep graph and silently adds any missing
                      @grest-ts/* peers to your dependencies.
                      Flags:
                        --dry-run   Show what would change without writing.
  help                Show this message.
`)
}

async function runUpdate(args) {
  const dryRun = args.includes("--dry-run") || args.includes("--dry")
  const positional = args.filter(a => !a.startsWith("--"))
  const versionArg = positional[0] || "latest"

  const cwd = process.cwd()
  const rootPkgPath = join(cwd, "package.json")
  if (!existsSync(rootPkgPath)) {
    throw new Error(`No package.json found in ${cwd}`)
  }
  const rootPkg = readJson(rootPkgPath)

  // 1. Discover all package.json files in the project
  const allPkgPaths = [rootPkgPath, ...findWorkspacePackages(cwd, rootPkg)]
  console.log(`Scanning ${allPkgPaths.length} package.json file(s)...`)

  // 2. Collect every @grest-ts/* dep referenced anywhere
  const grestDeps = new Set()
  for (const p of allPkgPaths) {
    const pkg = readJson(p)
    for (const block of DEP_BLOCKS) {
      if (!pkg[block]) continue
      for (const key of Object.keys(pkg[block])) {
        if (key.startsWith(GREST_PREFIX)) grestDeps.add(key)
      }
    }
  }

  if (grestDeps.size === 0) {
    console.log("No @grest-ts/* dependencies found. Nothing to do.")
    return
  }
  console.log(`Found ${grestDeps.size} unique @grest-ts/* dependency name(s).`)

  // 3. Resolve target version (handle dist-tags). Pin exactly — grest-ts
  //    publishes all packages in lockstep with each other's peers declared
  //    at the exact version, so the consumer must match exactly.
  const targetVersion = await resolveTargetVersion(versionArg)
  const canonicalRange = targetVersion
  console.log(`Target version: ${targetVersion}`)

  // 4. Pre-flight: every grest-ts package must be published at target version.
  //    grest-ts is single-version across all packages — partial publishes would
  //    leave the project wedged with peer-dep mismatches.
  console.log("Verifying all packages are published at target version...")
  const missing = []
  await Promise.all([...grestDeps].map(async name => {
    if (!(await packageVersionExists(name, targetVersion))) {
      missing.push(name)
    }
  }))
  if (missing.length > 0) {
    throw new Error(
      `Not published at ${targetVersion}:\n  ` + missing.join("\n  ") +
      `\n\ngrest-ts requires all @grest-ts/* packages at the same version. Wait for the publish to complete and retry.`
    )
  }

  // 5. Walk the peer-dep graph at the target version and silently add any
  //    missing @grest-ts/* peers to the root project. Each grest-ts package
  //    declares its internal cross-deps as peerDependencies — when a consumer
  //    adds @grest-ts/http but forgets @grest-ts/schema, npm warns and the
  //    framework's runtime dedup check has nothing to dedup against. Better
  //    to fix it here.
  console.log("Walking peer-dep graph to discover missing peers...")
  const peerCache = new Map()
  const expandedDeps = new Set(grestDeps)
  const queue = [...grestDeps]
  while (queue.length > 0) {
    const name = queue.shift()
    let manifest
    try {
      manifest = await fetchJson(`https://registry.npmjs.org/${name}/${targetVersion}`)
    } catch (e) {
      throw new Error(`Failed to fetch ${name}@${targetVersion} manifest: ${e.message}`)
    }
    const peers = manifest.peerDependencies || {}
    peerCache.set(name, peers)
    for (const peerName of Object.keys(peers)) {
      if (peerName.startsWith(GREST_PREFIX) && !expandedDeps.has(peerName)) {
        expandedDeps.add(peerName)
        queue.push(peerName)
      }
    }
  }

  // Anything in expandedDeps not already in the root package.json gets added
  // to its dependencies block at the target version.
  const autoAdded = []
  for (const name of expandedDeps) {
    if (!isInAnyBlock(rootPkg, name)) {
      autoAdded.push(name)
    }
  }
  if (autoAdded.length > 0) {
    console.log(`Adding ${autoAdded.length} missing peer(s) to ${relativeTo(cwd, rootPkgPath)}:`)
    for (const name of autoAdded) console.log(`  + ${name}`)
  }

  // 6. Rewrite every package.json — normalize every @grest-ts/* range to canonical form.
  //    For the root, also insert any auto-discovered missing peers into "dependencies".
  let totalChanged = 0
  let filesChanged = 0
  for (const p of allPkgPaths) {
    const raw = readFileSync(p, "utf-8")
    const pkg = JSON.parse(raw)
    let fileChanged = false

    if (p === rootPkgPath && autoAdded.length > 0) {
      pkg.dependencies = pkg.dependencies || {}
      for (const name of autoAdded) {
        pkg.dependencies[name] = canonicalRange
      }
      fileChanged = true
      totalChanged += autoAdded.length
    }

    for (const block of DEP_BLOCKS) {
      if (!pkg[block]) continue
      for (const key of Object.keys(pkg[block])) {
        if (!key.startsWith(GREST_PREFIX)) continue
        if (pkg[block][key] !== canonicalRange) {
          pkg[block][key] = canonicalRange
          fileChanged = true
          totalChanged++
        }
      }
    }
    if (fileChanged) {
      filesChanged++
      const trailingNewline = raw.endsWith("\n") ? "\n" : ""
      const out = JSON.stringify(pkg, null, 2) + trailingNewline
      if (dryRun) {
        console.log(`  [dry] would update ${relativeTo(cwd, p)}`)
      } else {
        writeFileSync(p, out)
        console.log(`  updated ${relativeTo(cwd, p)}`)
      }
    }
  }
  console.log(`${dryRun ? "[dry] " : ""}Updated ${totalChanged} dep entries across ${filesChanged} file(s).`)

  if (dryRun) {
    console.log("\nDry run complete. Re-run without --dry-run to apply.")
    return
  }

  // No package.json edits → assume node_modules is already consistent with the
  // (now-canonical) lockfile and skip the destructive reinstall. Repeated runs
  // become a true no-op instead of churning the lockfile and re-fetching deps.
  if (totalChanged === 0) {
    console.log(`\n✓ All @grest-ts/* already at ${canonicalRange}. Nothing to do.`)
    return
  }

  // 7. Clear lockfile + installed @grest-ts/* state.
  //    Three things hold npm to old grest-ts versions:
  //    - package-lock.json (the visible lockfile)
  //    - node_modules/.package-lock.json (npm's hidden install-state lockfile)
  //    - node_modules/@grest-ts/* (whose package.json files declare exact-pinned
  //      peer deps that conflict with the new versions)
  //    All three must go for npm to re-resolve grest-ts cleanly.
  const lockPath = join(cwd, "package-lock.json")
  if (existsSync(lockPath)) {
    console.log("Deleting package-lock.json...")
    unlinkSync(lockPath)
  }
  const hiddenLockPath = join(cwd, "node_modules", ".package-lock.json")
  if (existsSync(hiddenLockPath)) {
    console.log("Deleting node_modules/.package-lock.json...")
    unlinkSync(hiddenLockPath)
  }
  const grestNodeModulesPath = join(cwd, "node_modules", "@grest-ts")
  if (existsSync(grestNodeModulesPath)) {
    console.log("Removing node_modules/@grest-ts/ ...")
    rmSync(grestNodeModulesPath, { recursive: true, force: true })
  }

  // 8. Reinstall. Pass as a single shell command string — Node refuses to spawn
  //    .cmd files directly on Windows (CVE-2024-27980), and passing arg arrays
  //    with shell:true triggers DEP0190.
  console.log("Running npm install...")
  const result = spawnSync("npm install", { stdio: "inherit", shell: true, cwd })
  if (result.status !== 0) {
    throw new Error(`npm install exited with code ${result.status}`)
  }

  console.log(`\n✓ Updated all @grest-ts/* to ${canonicalRange}`)
}

// ---- helpers ----

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"))
}

function isInAnyBlock(pkg, depName) {
  for (const block of DEP_BLOCKS) {
    if (pkg[block] && Object.hasOwn(pkg[block], depName)) return true
  }
  return false
}

function relativeTo(base, path) {
  if (path.startsWith(base)) {
    const rel = path.slice(base.length).replace(/^[\\/]+/, "")
    return rel || "."
  }
  return path
}

function findWorkspacePackages(rootDir, rootPkg) {
  const ws = rootPkg.workspaces
  if (!ws) return []
  const patterns = Array.isArray(ws) ? ws : (ws.packages || [])

  const pkgPaths = []
  for (const pattern of patterns) {
    if (pattern.includes("**")) {
      throw new Error(`Recursive workspace globs are not supported: "${pattern}"`)
    }
    if (pattern.includes("*")) {
      // Only support the common "dir/*" trailing-star form.
      const idx = pattern.indexOf("*")
      const remainder = pattern.slice(idx)
      if (remainder !== "*") {
        throw new Error(`Workspace glob form not supported: "${pattern}" (only "dir/*" is supported)`)
      }
      const baseRel = pattern.slice(0, idx).replace(/[\\/]$/, "")
      const baseAbs = resolve(rootDir, baseRel)
      if (!existsSync(baseAbs)) continue
      for (const entry of readdirSync(baseAbs, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = join(baseAbs, entry.name, "package.json")
        if (existsSync(candidate)) pkgPaths.push(candidate)
      }
    } else {
      const candidate = resolve(rootDir, pattern, "package.json")
      if (existsSync(candidate)) pkgPaths.push(candidate)
    }
  }
  return pkgPaths
}

async function resolveTargetVersion(versionArg) {
  // If versionArg looks like a concrete version, return it as-is.
  if (/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(versionArg)) {
    return versionArg
  }
  // Otherwise treat as a dist-tag and look it up against @grest-ts/http.
  const probe = `${GREST_PREFIX}http`
  const data = await fetchJson(`https://registry.npmjs.org/${probe}`)
  const tags = data["dist-tags"] || {}
  const v = tags[versionArg]
  if (!v) {
    const known = Object.keys(tags).join(", ") || "(none)"
    throw new Error(`No dist-tag "${versionArg}" on ${probe}. Known tags: ${known}`)
  }
  return v
}

async function packageVersionExists(pkgName, version) {
  const url = `https://registry.npmjs.org/${pkgName}/${version}`
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

main().catch(err => {
  console.error(`\nError: ${err.message}`)
  if (process.env.DEBUG) console.error(err.stack)
  process.exit(1)
})
