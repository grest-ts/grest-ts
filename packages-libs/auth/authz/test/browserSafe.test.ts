import {readFileSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {expect, test} from "vitest"

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src")

function reachable(entry: string): {seen: Set<string>, packages: Set<string>} {
    const seen = new Set<string>()
    const packages = new Set<string>()
    const visit = (file: string) => {
        if (seen.has(file)) return
        seen.add(file)
        const code = readFileSync(file, "utf8")
        expect(code, file).not.toMatch(/\bprocess\.|\bBuffer\.|\brequire\(|__dirname|"node:/)
        for (const [, spec] of code.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
            if (spec!.startsWith(".")) visit(resolve(dirname(file), spec!.endsWith(".ts") ? spec! : `${spec}.ts`))
            else packages.add(spec!)
        }
    }
    visit(resolve(src, entry))
    return {seen, packages}
}

test("both entries are free of Node built-ins and use only browser-capable grest-ts packages", () => {
    const {packages} = reachable("index-node.ts")
    for (const p of packages) {
        const manifest = resolve(dirname(fileURLToPath(import.meta.resolve(p))), "../package.json")
        expect(JSON.parse(readFileSync(manifest, "utf8")).exports["."].browser, p).toBeDefined()
    }
})

test("the browser entry leaves the engine out", () => {
    const {seen} = reachable("index-browser.ts")
    expect([...seen].map(f => f.slice(src.length + 1)).filter(f => f.startsWith("node/"))).toEqual([])
})
