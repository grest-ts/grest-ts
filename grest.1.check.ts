// Full validation pipeline: cleans caches/generated files, runs npm install,
// regenerates configs (tsconfig, package.json, vitest), and type-checks the
// monorepo + example projects. Run via `npm run check`.
import {execSync, exec} from "child_process";
import {promisify} from "util";
import path from "path";
import fg from "fast-glob";
import fs from "fs";
import * as esbuild from "esbuild";
import {generateTestkitExtensions} from "#scripts/packager/generate-testkit-extensions";

const execAsync = promisify(exec);

/** Run `fn` over `items` with at most `limit` in flight. */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
        while (next < items.length) await fn(items[next++]);
    });
    await Promise.all(workers);
}

/** Names of every package that opts into a browser target (`browser: true` in grest.package.ts). */
function getBrowserPackages(): string[] {
    const root = import.meta.dirname;
    const pkgFiles = fg.sync("**/grest.package.ts", {cwd: root, absolute: true, ignore: ["**/node_modules/**"]});
    const names: string[] = [];
    for (const file of pkgFiles) {
        const src = fs.readFileSync(file, "utf-8");
        if (!/\bbrowser:\s*true\b/.test(src)) continue;
        const name = src.match(/\bname:\s*["']([^"']+)["']/)?.[1];
        if (name) names.push(name);
    }
    return names.sort();
}

function cleanupGeneratedFiles() {
    console.log("\n\n--------------------------------------------\n📦 Cleaning up possible typescript generated files...");
    const pattern = path.join(import.meta.dirname, "**/*.ts").replace(/\\/g, "/");
    const tsFiles = fg.sync(pattern, {
        absolute: true,
        ignore: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"]
    });
    let deletedCount = 0;
    for (const tsFile of tsFiles) {
        const basePath = tsFile.replace(/\.ts$/, "");
        const generatedFiles = [
            `${basePath}.js`,
            `${basePath}.d.ts`,
            `${basePath}.d.ts.map`,
            `${basePath}.js.map`
        ];
        for (const file of generatedFiles) {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                deletedCount++;
            }
        }
    }
    console.log(`✅ Cleanup: deleted ${deletedCount} generated file(s)`);
}

function cleanupCaches() {
    console.log("\n\n--------------------------------------------\n📦 Clearing up caches...");
    const patterns = [
        "node_modules/.vite",
        "**/*.tsbuildinfo"
    ];

    let deletedCount = 0;

    for (const pattern of patterns) {
        const files = fg.sync(path.join(import.meta.dirname, pattern).replace(/\\/g, "/"), {
            absolute: true,
            ignore: ["**/node_modules/**"],
            onlyFiles: false
        });

        for (const file of files) {
            fs.rmSync(file, {recursive: true, force: true});
            deletedCount++;
        }
    }

    console.log(`✅ Cleanup: deleted ${deletedCount} cache file(s)`);
}

function cleanupWindowsNulFile() {
    if (process.platform !== "win32") return;

    const nulPath = path.join(import.meta.dirname, "NUL");
    // Check if the NUL file exists (AI tools sometimes accidentally create it)
    try {
        fs.accessSync(nulPath);
        console.log("📦 Removing accidentally created NUL file...");
        // On Windows, files with reserved names require \\?\ prefix to delete
        execSync(`rename "\\\\?\\${nulPath}" tempfile.txt && del "\\\\?\\${path.join(import.meta.dirname, "tempfile.txt")}"`, {
            stdio: "inherit",
            cwd: import.meta.dirname
        });
        console.log("✅ NUL file removed");
    } catch {
        // File doesn't exist or already deleted - that's fine
    }
}

function typeCheckProject(project: string) {
    const projectPath = path.join(import.meta.dirname, project);
    if (!fs.existsSync(projectPath)) {
        console.log(`⚠️  Skipping ${project} (not found)`);
        return;
    }

    console.log(`\n📦 Type checking ${project}...`);
    try {
        execSync("npx tsc --noEmit", {stdio: "inherit", cwd: projectPath});
        console.log(`✅ ${project}: passed`);
    } catch (e) {
        console.error(`❌ ${project}: failed`);
        process.exit(1);
    }
}

// Bundle each browser-targeted package's entry for the browser and fail if any
// pulls a Node builtin. Browser/node packages keep one shared core and isolate
// the Node-only bits in *.node files swapped in by the node entry; this is the
// only thing that proves a browser-reachable file never statically OR dynamically
// (bundlers resolve `import()` at build time) imports a node-only module. Without
// it, leaks stay silent in grest-ts and only surface in a downstream `vite build`.
async function checkBrowserBundlePurity() {
    console.log("\n\n--------------------------------------------\n📦 Checking browser bundle purity (no Node-only imports reach browser entries)...");
    const root = import.meta.dirname;
    const browserPkgs = getBrowserPackages();

    const failures: string[] = [];
    for (const pkg of browserPkgs) {
        try {
            await esbuild.build({
                stdin: {contents: `import * as m from "${pkg}"; console.log(m)`, resolveDir: root, loader: "ts"},
                bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent",
            });
            console.log(`  ✅ ${pkg}`);
        } catch (e: any) {
            const detail = (e.errors ?? []).map((x: any) => `${x.text}${x.location ? ` (${x.location.file}:${x.location.line})` : ""}`).join("; ");
            failures.push(`${pkg}: ${detail}`);
            console.log(`  ❌ ${pkg} — ${detail}`);
        }
    }
    if (failures.length > 0) {
        throw new Error(`Browser bundle purity check failed for ${failures.length} package(s) — a browser-reachable file imports a Node-only module:\n  ${failures.join("\n  ")}`);
    }
    console.log(`✅ Browser bundle purity: ${browserPkgs.length} package(s) clean`);
}

// Type-check the browser packages the way a *browser* consumer compiles them: bundler
// resolution with the "browser" export condition (so index-browser.ts is selected and
// *.node files are never pulled in), DOM libs, no @types/node. The root `tsc` typecheck
// compiles the full node program — where a class's *.node augmentation supplies members
// the browser bundle lacks — so browser-only type errors are invisible there and only
// surface downstream in a consumer's `vite build`. This reproduces that context.
async function checkBrowserTypes() {
    console.log("\n\n--------------------------------------------\n📦 Type checking browser packages in a browser context...");
    const root = import.meta.dirname;
    const pkgs = getBrowserPackages();
    const tmpDir = path.join(root, ".tmp-browser-typecheck");
    fs.rmSync(tmpDir, {recursive: true, force: true});
    fs.mkdirSync(tmpDir, {recursive: true});
    try {
        const entry = pkgs.map((p, i) => `import * as m${i} from "${p}";`).join("\n")
            + `\nexport const _all = [${pkgs.map((_, i) => `m${i}`).join(", ")}];\n`;
        fs.writeFileSync(path.join(tmpDir, "entry.ts"), entry);
        fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
            compilerOptions: {
                module: "esnext",
                moduleResolution: "bundler",
                customConditions: ["browser"],
                target: "ES2022",
                lib: ["ES2022", "DOM", "DOM.Iterable"],
                types: [],
                skipLibCheck: true,
                strict: true,
                esModuleInterop: true,
                jsx: "react-jsx",
                noEmit: true,
            },
            include: ["entry.ts"],
        }, null, 2));
        try {
            execSync("npx tsc -p tsconfig.json", {stdio: "inherit", cwd: tmpDir});
        } catch {
            throw new Error(`Browser type check failed — a browser-reachable file in [${pkgs.join(", ")}] does not type-check under DOM libs without its .node half (see errors above).`);
        }
        console.log(`✅ Browser type check: ${pkgs.length} package(s) clean`);
    } finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    }
}

// Type-check each package's generated test/ and testkit/ tsconfig in ISOLATION, the way a
// consumer (or a per-package build) compiles them — not merged into the one root program.
// The root program carries `types: ['node','vitest/globals']` and loads every package's
// module augmentations at once, masking two failure modes: a per-package config missing
// vitest globals, and a testkit cast that only resolves when *all* SelectorExtensions
// augmentations happen to be present. It also catches a generated config left with no
// inputs (an orphaned test/ or testkit/ folder whose .ts files moved or were removed).
async function checkIsolatedConfigs() {
    console.log("\n\n--------------------------------------------\n📦 Type checking per-package test/ + testkit/ configs in isolation...");
    const root = import.meta.dirname;
    const configs = fg.sync(
        ["{packages,packages-libs,packages-tooling}/**/test/tsconfig.json", "{packages,packages-libs,packages-tooling}/**/testkit/tsconfig.json"],
        {cwd: root, absolute: true, ignore: ["**/node_modules/**", "**/src/**"]},
    ).sort();

    const failures: string[] = [];
    await runPool(configs, 6, async (cfg) => {
        const rel = path.relative(root, cfg);
        try {
            await execAsync(`npx tsc -p "${cfg}" --noEmit`, {cwd: root, maxBuffer: 10 * 1024 * 1024});
            console.log(`  ✅ ${rel}`);
        } catch (e: any) {
            const lines = `${e.stdout ?? ""}${e.stderr ?? ""}`.split("\n").filter((l: string) => l.includes("error TS"));
            const orphan = lines.some((l: string) => l.includes("TS18003"));
            const detail = orphan
                ? "orphaned generated config (no .ts inputs) — delete the empty test/testkit folder or add tests"
                : lines.slice(0, 3).join("\n      ");
            failures.push(`${rel}:\n      ${detail}`);
            console.log(`  ❌ ${rel}`);
        }
    });

    if (failures.length > 0) {
        throw new Error(`Isolated config type check failed for ${failures.length} config(s):\n  ${failures.join("\n  ")}`);
    }
    console.log(`✅ Isolated configs: ${configs.length} config(s) clean`);
}

// Run checks

console.log("\n\n--------------------------------------------\n📦 Running npm install");
execSync("npm install", {stdio: "inherit", cwd: import.meta.dirname});
console.log("✅ NPM install completed");
cleanupGeneratedFiles();
cleanupCaches();
cleanupWindowsNulFile();

console.log("\n\n--------------------------------------------\n📦 Running gg config generation (tsconfig, package, vitest config etc...)");
execSync("npm run generate", {stdio: "inherit", cwd: import.meta.dirname});
console.log("✅ Config generation completed");

console.log("\n\n--------------------------------------------\n📦 Regenerating testkit extension references...");
generateTestkitExtensions();
console.log("✅ Extension references generated");

console.log("\n\n--------------------------------------------\n📦 Running type check...");
execSync("npm run typecheck", {stdio: "inherit", cwd: import.meta.dirname});
console.log("✅ Type check passed");

console.log("\n\n--------------------------------------------\n📦 Type checking example projects...");
typeCheckProject("examples/checklist")
typeCheckProject("examples/grest-test")
console.log("\n✅ All example projects passed type check");

await checkBrowserBundlePurity();
await checkBrowserTypes();
await checkIsolatedConfigs();
