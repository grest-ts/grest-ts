import {readFileSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {expect, test} from "vitest"

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src")

// Node built-ins and non-browser packages are the packager's check (GGBrowserEntryChecker); this one is authz's own split.
test("the browser entry leaves the engine out", () => {
    const seen = new Set<string>()
    const visit = (file: string) => {
        if (seen.has(file)) return
        seen.add(file)
        for (const [, spec] of readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"(\.[^"]+)"/g)) {
            visit(resolve(dirname(file), spec!.endsWith(".ts") ? spec! : `${spec}.ts`))
        }
    }
    visit(resolve(src, "index-browser.ts"))
    expect([...seen].map(f => f.slice(src.length + 1)).filter(f => f.startsWith("node/"))).toEqual([])
})
