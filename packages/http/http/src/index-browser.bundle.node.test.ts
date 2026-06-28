import {describe, it, expect} from 'vitest'
import {readFileSync, existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// Walk the real import graph from the browser entry and assert nothing node-only is reachable:
// no `node:*` specifier and no `*.node` module. This is what would otherwise leak `node:https`
// (the pinned-TLS transport) into a browser build.
const SRC = dirname(fileURLToPath(import.meta.url))

function localImports(file: string): string[] {
    const code = readFileSync(file, "utf8")
    const specifiers = [...code.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map(m => m[1])
    return specifiers.filter(s => s.startsWith("."))
}

function resolveLocal(fromFile: string, spec: string): string | undefined {
    const base = resolve(dirname(fromFile), spec)
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(candidate)) return candidate
    }
    return undefined
}

describe('browser bundle safety', () => {
    it('the browser entry graph references no node:* import and no *.node module', () => {
        const offenders: string[] = []
        const seen = new Set<string>()
        const queue = [resolve(SRC, "index-browser.ts")]

        while (queue.length) {
            const file = queue.shift()!
            if (seen.has(file)) continue
            seen.add(file)

            const code = readFileSync(file, "utf8")
            if (/(?:from|import)\s+["']node:/.test(code)) offenders.push(`${file} imports a node:* module`)

            for (const spec of localImports(file)) {
                if (/\.node$/.test(spec)) {
                    offenders.push(`${file} imports node-only module "${spec}"`)
                    continue
                }
                const target = resolveLocal(file, spec)
                if (target) queue.push(target)
            }
        }

        expect(offenders).toEqual([])
    })
})
