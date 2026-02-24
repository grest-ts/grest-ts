import path from "path";
import {execSync} from "child_process";

export function runGG(testDir: string, configPath: string): void {
    const fullConfigPath = path.resolve(testDir, configPath)
    const configDir = path.dirname(fullConfigPath)

    // Run grest command in the config directory using the compiled bin script
    // This runs outside of Vite/vitest context using the built dist code
    const binPath = path.resolve(__dirname, '../../bin/grest.cjs')

    try {
        execSync(`node "${binPath}" --cwd "${configDir}"`, {
            encoding: 'utf-8',
            stdio: 'inherit' // Show generation output in test logs
        })
    } catch (error: any) {
        throw new Error(`Code generation failed: ${error.message}`)
    }
}