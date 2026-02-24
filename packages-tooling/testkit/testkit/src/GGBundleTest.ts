import {describe, test, expect, beforeAll} from "vitest";
import {fileURLToPath} from "url";
import type {BuildResult, Plugin} from "esbuild";

const FORBIDDEN_SYMBOLS = {
    IPC: ['IPCServer', 'IPCClient', 'IPCSocket'],
    'discovery-local': [
        'GGLocalDiscoveryClient',
        'GGLocalDiscoveryResilientClient',
        'GGLocalDiscoveryServer',
    ],
    testkit: [
        'GGTestRunner',
        'GGTestRuntime',
        'startWorker',
        'startInline',
        'startIsolated',
    ],
} as const;

interface GGBundleTestOptions {
    entryPoint: string;
}

export class GGBundleTest {

    static verify(options: GGBundleTestOptions) {
        const entryPoint = options.entryPoint.startsWith('file://')
            ? fileURLToPath(options.entryPoint)
            : options.entryPoint;

        describe("production bundle", () => {
            let result: BuildResult;
            let bundleText: string;

            beforeAll(async () => {
                const esbuild = await import("esbuild");

                const externalizeNonGG: Plugin = {
                    name: 'externalize-non-gg',
                    setup(build) {
                        build.onResolve({filter: /./}, args => {
                            // Only externalize import statements, not entry points
                            if (args.kind !== 'import-statement' && args.kind !== 'dynamic-import') return null;
                            // Keep relative/absolute paths bundled
                            if (args.path.startsWith('.') || args.path.startsWith('/')) return null;
                            // Keep @grest-ts/* packages bundled
                            if (args.path.startsWith('@grest-ts/')) return null;
                            return {path: args.path, external: true};
                        });
                    }
                };

                result = await esbuild.build({
                    entryPoints: [entryPoint],
                    bundle: true,
                    write: false,
                    platform: 'node',
                    format: 'esm',
                    define: {'process.env.NODE_ENV': '"production"'},
                    plugins: [externalizeNonGG],
                });

                bundleText = result.outputFiles!.map(f => f.text).join('\n');
            });

            test("bundle has no errors", () => {
                expect(result.errors).toHaveLength(0);
            });

            test("bundle is non-trivially sized", () => {
                expect(bundleText.length).toBeGreaterThan(100);
            });

            for (const [group, symbols] of Object.entries(FORBIDDEN_SYMBOLS)) {
                for (const symbol of symbols) {
                    test(`does not contain dev-only symbol: ${symbol} (${group})`, () => {
                        // Match actual definitions (var X = class, class X, function X)
                        // but not dead-code references like: const { X } = await null
                        const definitionPattern = new RegExp(
                            `\\b(var|let|const|class|function)\\s+${symbol}\\b`
                        );
                        expect(bundleText).not.toMatch(definitionPattern);
                    });
                }
            }
        });
    }
}
