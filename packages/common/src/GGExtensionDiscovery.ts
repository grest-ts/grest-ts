import fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import {pathToFileURL} from 'url';

/**
 * Discovers extension packages by scanning node_modules + monorepo packages
 * for a {name}/index-{name}.ts (or compiled .js) entry. Each discovered file
 * is dynamically imported once per process, triggering its side-effect
 * registrations (selector extensions, IPC handlers, test components, codegen
 * builders, …).
 *
 * Type-level discovery (so consumers' TS sees `declare module` augmentations)
 * is handled separately by scripts/packager/generate-testkit-extensions.ts —
 * this class is concerned only with runtime registration.
 */
export class GGExtensionDiscovery {

    private static loadedExtensions = new Set<string>();

    private readonly name: string;
    private readonly filePattern: string;

    constructor(name: string) {
        this.name = name;
        this.filePattern = `${name}/index-${name}.ts`;
    }

    /**
     * Discover and dynamically import every extension entry once per process.
     */
    public async load(): Promise<void> {
        if (GGExtensionDiscovery.loadedExtensions.has(this.name)) {
            return;
        }
        GGExtensionDiscovery.loadedExtensions.add(this.name);

        const extensions = await this.scan(process.cwd());
        for (const extension of extensions) {
            await import(pathToFileURL(extension).href);
        }
    }

    public async scan(cwd: string): Promise<string[]> {
        const extensions: string[] = [];

        // Resolve extensions by reading package.json dependencies and walking up
        // node_modules directories (like Node.js module resolution).
        // This works regardless of hoisting, workspaces, pnpm, etc.
        const depNames = this.readDependencyNames(cwd);

        for (const dep of depNames) {
            const pkgDir = this.resolvePackageDir(dep, cwd);
            if (pkgDir) {
                // Check source path first (local dev with tsx), then compiled dist path (published packages)
                const sourceFile = path.join(pkgDir, this.filePattern);
                const distFile = path.join(pkgDir, 'dist', this.filePattern.replace(/\.ts$/, '.js'));
                if (fs.existsSync(sourceFile)) {
                    extensions.push(sourceFile);
                } else if (fs.existsSync(distFile)) {
                    extensions.push(distFile);
                }
            }
        }

        // Also scan monorepo packages/ directories (for framework development)
        const monorepoRoot = this.findMonorepoRoot(cwd);
        if (monorepoRoot) {
            const monorepoExtensions = await fg([
                `packages/*/${this.filePattern}`,
                `packages/*/*/${this.filePattern}`,
                `packages-*/*/${this.filePattern}`,
                `packages-*/*/*/${this.filePattern}`,
            ], {
                cwd: monorepoRoot,
                absolute: true,
                onlyFiles: true
            });
            extensions.push(...monorepoExtensions);
        }

        // Resolve symlinks to real paths before deduping to avoid loading same file twice
        // (e.g., node_modules/@grest-ts/foo -> packages/foo would otherwise be seen as different)
        const resolvedExtensions = extensions.map(ext => fs.realpathSync(ext));
        return [...new Set(resolvedExtensions)].sort();
    }

    /**
     * Resolve a package's install directory by walking up node_modules directories from cwd.
     * Mimics Node.js module resolution: checks cwd/node_modules/<pkg>, ../node_modules/<pkg>, etc.
     */
    private resolvePackageDir(dep: string, cwd: string): string | null {
        let dir = cwd;
        const root = path.parse(dir).root;
        while (dir !== root) {
            const pkgDir = path.join(dir, 'node_modules', dep);
            if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
                return pkgDir;
            }
            dir = path.dirname(dir);
        }
        return null;
    }

    private readDependencyNames(cwd: string): string[] {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
            return [
                ...Object.keys(pkg.dependencies || {}),
                ...Object.keys(pkg.devDependencies || {}),
            ];
        } catch {
            return [];
        }
    }

    public findMonorepoRoot(startDir: string): string | null {
        let currentDir = startDir;
        const root = path.parse(currentDir).root;

        while (currentDir !== root) {
            const packagesPath = path.join(currentDir, 'packages');
            try {
                const stat = fs.statSync(packagesPath);
                if (stat.isDirectory()) {
                    return currentDir;
                }
            } catch {
                // Directory doesn't exist, continue up
            }
            currentDir = path.dirname(currentDir);
        }

        return null;
    }
}
