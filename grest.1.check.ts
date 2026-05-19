// Full validation pipeline: cleans caches/generated files, runs npm install,
// regenerates configs (tsconfig, package.json, vitest), and type-checks the
// monorepo + example projects. Run via `npm run check`.
import {execSync} from "child_process";
import path from "path";
import fg from "fast-glob";
import fs from "fs";
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
