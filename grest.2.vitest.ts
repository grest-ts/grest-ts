// Runs the full vitest test suite across the monorepo.
// Usage: tsx grest.2.test.ts
import {execSync} from "child_process";
import {resolve} from "path";

const ROOT = resolve(import.meta.dirname);

console.log("📦 Running vitest...\n");
try {
    execSync("npx vitest run", {stdio: "inherit", cwd: ROOT});
    console.log("\n✅ All tests passed");
} catch (e) {
    console.error("\n❌ Tests failed");
    process.exit(1);
}
