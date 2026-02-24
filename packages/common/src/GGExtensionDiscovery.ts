import fg from 'fast-glob';
import * as fs from 'fs';
import * as path from 'path';
import {pathToFileURL} from 'url';

const TYPES_FILE = 'index.d.ts';
const LOCK_FILE = 'index.d.ts.lock';

const CACHE_START = '/* @cache-start ';
const CACHE_END = ' @cache-end */';

interface ExtensionCache {
    lockfileMtime: number;
    extensions: string[];
}

/**
 * Discovers extensions by scanning node_modules for packages
 * that follow the convention of having a {name}/index-{name}.ts file.
 *
 * For example, with name="testkit":
 * - Scans for: testkit/index-testkit.ts
 * - Types dir: node_modules/@types/grest-ts-testkits
 *
 * Generates:
 * - node_modules/@types/grest-ts-{name}s/index.d.ts - For IDE type completion (triple-slash references)
 *
 * Runtime loading is done via dynamic imports of discovered extensions.
 */
export class GGExtensionDiscovery {

    private static loadedExtensions = new Set<string>();

    private readonly name: string;
    private readonly typesDir: string;
    private readonly filePattern: string;

    /**
     * Create a new extension discovery instance.
     * @param name The extension name (e.g., "testkit", "codegen")
     */
    constructor(name: string) {
        this.name = name;
        this.typesDir = `node_modules/@types/grest-ts-${name}s`;
        this.filePattern = `${name}/index-${name}.ts`;
    }

    /**
     * Generate types file for IDE support without loading extensions.
     * Use this during build/check steps to ensure IDE has proper type completion.
     */
    public async generateTypes(): Promise<void> {
        const cwd = process.cwd();
        const typesDir = path.join(cwd, this.typesDir);
        const typesFile = path.join(typesDir, TYPES_FILE);

        const lockfileMtime = this.getLockfileMtime(cwd);
        const extensions = await this.scan(cwd);
        this.writeTypesFile(typesFile, extensions, typesDir, lockfileMtime);
        console.log(`[GG${this.capitalize(this.name)}] Generated types for ${extensions.length} ${this.name}(s)`);
    }

    /**
     * Discover and load all extensions.
     * - Scans for extension packages
     * - Generates .d.ts file for IDE support
     * - Dynamically imports extensions for runtime
     */
    public async load(): Promise<void> {
        if (GGExtensionDiscovery.loadedExtensions.has(this.name)) {
            return;
        }
        GGExtensionDiscovery.loadedExtensions.add(this.name);

        const cwd = process.cwd();
        const typesDir = path.join(cwd, this.typesDir);
        const typesFile = path.join(typesDir, TYPES_FILE);
        const lockFile = path.join(typesDir, LOCK_FILE);

        // Try to acquire lock
        if (this.acquireLock(lockFile)) {
            try {
                await this.discoverAndLoad(cwd, typesFile, typesDir);
            } finally {
                this.releaseLock(lockFile);
            }
        } else {
            // Wait for lock to be released, then load from cache
            await this.waitForLock(lockFile);
            await this.loadFromCache(typesFile);
        }
    }

    private acquireLock(lockFile: string): boolean {
        try {
            fs.mkdirSync(path.dirname(lockFile), {recursive: true});
            fs.writeFileSync(lockFile, String(process.pid), {flag: 'wx'});
            return true;
        } catch {
            return false;
        }
    }

    private releaseLock(lockFile: string): void {
        try {
            fs.unlinkSync(lockFile);
        } catch {
            // Ignore
        }
    }

    private async waitForLock(lockFile: string, timeout = 30000): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (!fs.existsSync(lockFile)) {
                return;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        // Timeout - try to clean up stale lock
        this.releaseLock(lockFile);
    }

    private async discoverAndLoad(cwd: string, typesFile: string, typesDir: string): Promise<void> {
        const lockfileMtime = this.getLockfileMtime(cwd);

        // Check cache embedded in types file
        const cached = this.readCache(typesFile);
        let extensions: string[];

        if (cached && cached.lockfileMtime === lockfileMtime) {
            extensions = cached.extensions;
        } else {
            extensions = await this.scan(cwd);
            this.writeTypesFile(typesFile, extensions, typesDir, lockfileMtime);
            console.log(`[GG${this.capitalize(this.name)}] Discovered ${extensions.length} ${this.name}(s)`);
        }

        // Dynamically import all extensions
        for (const extension of extensions) {
            await import(pathToFileURL(extension).href);
        }
    }

    private async loadFromCache(typesFile: string): Promise<void> {
        const cached = this.readCache(typesFile);

        if (cached) {
            for (const extension of cached.extensions) {
                await import(pathToFileURL(extension).href);
            }
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

    private getLockfileMtime(cwd: string): number {
        const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];

        // Walk up directories to find lockfile (handles workspaces where lockfile is at root)
        let dir = cwd;
        const root = path.parse(dir).root;
        while (dir !== root) {
            for (const lockfile of lockfiles) {
                try {
                    return fs.statSync(path.join(dir, lockfile)).mtimeMs;
                } catch {
                    // File doesn't exist, try next
                }
            }
            dir = path.dirname(dir);
        }
        return 0;
    }

    private readCache(typesFile: string): ExtensionCache | null {
        try {
            const content = fs.readFileSync(typesFile, 'utf-8');
            const startIdx = content.indexOf(CACHE_START);
            const endIdx = content.indexOf(CACHE_END);
            if (startIdx === -1 || endIdx === -1) {
                return null;
            }
            const jsonStr = content.slice(startIdx + CACHE_START.length, endIdx).trim();
            return JSON.parse(jsonStr);
        } catch {
            return null;
        }
    }

    private writeTypesFile(typesFile: string, extensions: string[], typesDir: string, lockfileMtime: number): void {
        const lines = [
            `// Auto-generated by GGExtensionDiscovery (${this.name}) - DO NOT EDIT`,
            '// TypeScript automatically includes @types/* packages, so no tsconfig changes needed.',
            ''
        ];

        for (const extension of extensions) {
            // For types file, reference .d.ts instead of .js/.ts for TypeScript to load type augmentations
            const typesPath = extension.replace(/\.(js|ts)$/, '.d.ts');
            const relativePath = path.relative(typesDir, typesPath).replace(/\\/g, '/');
            lines.push(`/// <reference path="${relativePath}" />`);
        }

        // Embed cache as JSON block comment at end of file (single line so TypeScript ignores it)
        lines.push('');
        lines.push(CACHE_START + JSON.stringify({lockfileMtime, extensions}) + CACHE_END);
        lines.push('');

        fs.mkdirSync(typesDir, {recursive: true});
        fs.writeFileSync(typesFile, lines.join('\n'));

        // Write package.json to make it a proper @types package
        const packageJson = {
            name: `@types/grest-ts-${this.name}s`,
            version: '1.0.0',
            types: 'index.d.ts'
        };
        fs.writeFileSync(path.join(typesDir, 'package.json'), JSON.stringify(packageJson, null, 2));
    }

    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}
