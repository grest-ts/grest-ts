// Full validation pipeline: cleans caches/generated files, runs npm install,
// regenerates configs (tsconfig, package.json, vitest), and type-checks the
// monorepo + example projects. Run via `npm run check`.
import {execSync} from "child_process";
import path from "path";
import fg from "fast-glob";
import fs from "fs";
import * as esbuild from "esbuild";
import {generateTestkitExtensions} from "#scripts/packager/generate-testkit-extensions";

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
    const pkgFiles = fg.sync("**/grest.package.ts", {cwd: root, absolute: true, ignore: ["**/node_modules/**"]});
    const browserPkgs: string[] = [];
    for (const file of pkgFiles) {
        const src = fs.readFileSync(file, "utf-8");
        if (!/\bbrowser:\s*true\b/.test(src)) continue;
        const name = src.match(/\bname:\s*["']([^"']+)["']/)?.[1];
        if (name) browserPkgs.push(name);
    }
    browserPkgs.sort();

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
