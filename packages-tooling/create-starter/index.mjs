#!/usr/bin/env node

import { cpSync, readdirSync, renameSync, readFileSync, writeFileSync, statSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { createInterface } from "readline/promises"

const __dirname = dirname(fileURLToPath(import.meta.url))
const templateDir = join(__dirname, "template")

function titleize(name) {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
}

function walkFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkFiles(full))
    } else {
      results.push(full)
    }
  }
  return results
}

async function main() {
  let name = process.argv[2]

  if (!name) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    name = await rl.question("Project name: ")
    rl.close()
  }

  name = name.trim()

  if (!name) {
    console.error("Error: project name is required.")
    process.exit(1)
  }

  if (existsSync(name)) {
    console.error(`Error: directory "${name}" already exists.`)
    process.exit(1)
  }

  const title = titleize(name)
  const targetDir = join(process.cwd(), name)

  console.log()
  console.log(`  Creating grest-ts project in ./${name}...`)
  console.log()

  // 1. Copy template
  cpSync(templateDir, targetDir, { recursive: true })

  // 2. Rename _package.json → package.json
  for (const file of walkFiles(targetDir)) {
    if (file.endsWith("_package.json")) {
      renameSync(file, join(dirname(file), "package.json"))
    }
  }

  // 3. Replace placeholders in .json, .ts, .html files
  for (const file of walkFiles(targetDir)) {
    if (/\.(json|ts|html)$/.test(file)) {
      let content = readFileSync(file, "utf-8")
      const original = content
      content = content.replaceAll("@newproject/", `@${name}/`)
      content = content.replaceAll('"new-project"', `"${name}"`)
      content = content.replaceAll("New Project", title)
      if (content !== original) {
        writeFileSync(file, content)
      }
    }
  }

  console.log(`  Done! Next steps:`)
  console.log()
  console.log(`    cd ${name}`)
  console.log(`    npm install`)
  console.log(`    cd server && npm run dev      # start the server`)
  console.log(`    cd client && npm run dev      # start the client (in another terminal)`)
  console.log()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
