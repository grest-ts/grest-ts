import {GGBenchTestCases, SKIP, TestDataDefinition, TestRunner} from "./TestRunner";
import {BenchmarkCollector} from "./BenchmarkCollector";
import {BenchmarkConfig, LibraryInfo, LibraryResult} from "./BenchmarkSchema";
import {ConsoleCollector} from "./collector/ConsoleCollector";
import {spawn} from "child_process";
import path from "path";
import {fileURLToPath} from "url";
import {TestCategory, LibraryTag, TestType} from "../constants";
import {resolveTagFilter} from "../libraries/registry";

export const DEFAULT_CONFIG: BenchmarkConfig = {
    timeBudgetMs: 100,
    warmupMs: 50,
    minIterations: 10,
};

interface LibraryEntry {
    name: string;
    library: GGBenchTestCases;
    tags: LibraryTag[];
}

export class Benchmarker {
    private testData: Map<TestCategory, TestDataDefinition<any>> = new Map();
    private libraries: LibraryEntry[] = [];
    private config: BenchmarkConfig;

    constructor(config?: Partial<BenchmarkConfig>) {
        this.config = {...DEFAULT_CONFIG, ...config};
    }

    addLibrary(name: string, library: GGBenchTestCases, tags: LibraryTag[]): this {
        this.libraries.push({name, library, tags});
        return this;
    }

    addTestData(data: TestDataDefinition<unknown>): this {
        this.testData.set(data.category as TestCategory, data);
        return this;
    }

    private getTester(library: GGBenchTestCases, category: TestCategory): TestRunner | undefined {
        return library[category] as TestRunner | undefined;
    }

    private deepEqual(a: any, b: any): boolean {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (typeof a !== 'object' || a === null || b === null) return false;

        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        const filteredA = keysA.filter(k => k !== 'EXTRA');
        const filteredB = keysB.filter(k => k !== 'EXTRA');

        if (filteredA.length !== filteredB.length) return false;

        for (const key of filteredA) {
            if (!filteredB.includes(key)) return false;
            if (!this.deepEqual(a[key], b[key])) return false;
        }

        return true;
    }

    private hasExtraRecursive(obj: any): boolean {
        if (typeof obj !== 'object' || obj === null) return false;
        if (Array.isArray(obj)) {
            return obj.some(item => this.hasExtraRecursive(item));
        }
        if ('EXTRA' in obj) return true;
        return Object.values(obj).some(v => this.hasExtraRecursive(v));
    }

    private filterLibraries(tagFilter?: string, libsFilter?: string): LibraryEntry[] {
        let result = this.libraries;

        // Filter by tag
        if (tagFilter) {
            const tags = resolveTagFilter(tagFilter);
            if (tags) {
                result = result.filter(l => l.tags.some(t => tags.includes(t)));
            }
        }

        // Filter by library name (comma-separated, substring match)
        if (libsFilter) {
            const patterns = libsFilter.toLowerCase().split(",").map(p => p.trim());
            result = result.filter(l =>
                patterns.some(pattern => l.name.toLowerCase().includes(pattern))
            );
        }

        return result;
    }

    runSanityTests(tagFilter?: string, libsFilter?: string): void {
        const failures: string[] = [];
        const filteredLibraries = this.filterLibraries(tagFilter, libsFilter);

        for (const [category, testData] of this.testData) {
            for (const {name, library} of filteredLibraries) {
                const tester = this.getTester(library, category);
                if (!tester) continue;

                tester.setObj(testData.correctObj, testData.wrongObj);
                tester.before();

                tester.prepare(TestType.is_correct);
                const isCorrectResult = tester.run(TestType.is_correct);
                const hasValidation = isCorrectResult !== SKIP;
                if (hasValidation && isCorrectResult !== true) {
                    failures.push(`${name} ${category} is_correct: expected true, got ${isCorrectResult}`);
                }

                tester.prepare(TestType.is_wrong);
                const isWrongResult = tester.run(TestType.is_wrong);
                if (isWrongResult !== SKIP && isWrongResult !== false) {
                    failures.push(`${name} ${category} is_wrong: expected false, got ${isWrongResult}`);
                }

                // Check error count (just verify count matches, print paths for debugging)
                if (hasValidation && testData.expectedErrorPaths.length > 0) {
                    const errorPaths = tester.test_errorPaths(testData.wrongObj);
                    if (errorPaths !== SKIP) {
                        if (errorPaths.length !== testData.expectedErrorPaths.length) {
                            failures.push(
                                `${name} ${category} error count mismatch:\n` +
                                `    expected ${testData.expectedErrorPaths.length}: [${testData.expectedErrorPaths.join(', ')}]\n` +
                                `    got ${errorPaths.length}: [${errorPaths.join(', ')}]`
                            );
                        }
                    }
                }

                tester.prepare(TestType.stringify_correct);
                const stringifyResult = tester.run(TestType.stringify_correct);
                if (stringifyResult !== SKIP && stringifyResult !== undefined) {
                    const roundtripObj = typeof stringifyResult === 'string'
                        ? JSON.parse(stringifyResult)
                        : tester.test_parse(stringifyResult);

                    let originalWithoutExtra = testData.correctObj;
                    if (typeof testData.correctObj === 'object' && testData.correctObj !== null) {
                        originalWithoutExtra = {...testData.correctObj};
                        delete (originalWithoutExtra as any).EXTRA;
                    }

                    if (!this.deepEqual(roundtripObj, originalWithoutExtra)) {
                        failures.push(`${name} ${category} roundtrip: mismatch`);
                    }

                    if (hasValidation && this.hasExtraRecursive(roundtripObj)) {
                        failures.push(`${name} ${category} stringify: did not strip EXTRA (check nested)`);
                    }
                }

                tester.prepare(TestType.parse_correct);
                const parseResult = tester.run(TestType.parse_correct);
                if (hasValidation && parseResult !== SKIP && parseResult !== undefined) {
                    if (this.hasExtraRecursive(parseResult)) {
                        failures.push(`${name} ${category} parse: did not strip EXTRA (check nested)`);
                    }
                }
            }
        }

        if (failures.length > 0) {
            throw new Error(`Sanity tests failed:\n  ${failures.join("\n  ")}`);
        }
    }

    private createSkippedResult(library: string): LibraryResult {
        return {
            library,
            count: 0,
            timeMs: 0,
            opsPerSec: 0,
            skipped: true
        };
    }

    async run(
        testTypeFilter?: string,
        tagFilter?: string,
        libsFilter?: string,
        collector: BenchmarkCollector = new ConsoleCollector(),
        parallel: number = 1
    ): Promise<void> {
        const filteredLibraries = this.filterLibraries(tagFilter, libsFilter);
        const libraryNames = filteredLibraries.map(l => l.name);

        console.log(`\nRunning ${libraryNames.length} libraries (parallelism: ${parallel})`);
        console.log(`Libraries: ${libraryNames.join(", ")}`);

        // Global activity indicator - print dot every 500ms
        const dotInterval = setInterval(() => process.stdout.write("."), 500);

        const allResults = new Map<string, WorkerResult>();
        const pending = [...libraryNames];
        const running = new Set<Promise<void>>();

        const runNext = async (): Promise<void> => {
            const name = pending.shift();
            if (!name) return;

            const result = await this.runWorker(name, testTypeFilter);
            if (result) {
                allResults.set(result.library, result);
            }
        };

        // Run workers with concurrency limit
        const startWorker = (): void => {
            if (pending.length === 0) return;

            const promise = runNext().then(() => {
                running.delete(promise);
                // Start next worker when one completes
                if (pending.length > 0) {
                    startWorker();
                }
            });
            running.add(promise);
        };

        // Start initial batch
        for (let i = 0; i < Math.min(parallel, libraryNames.length); i++) {
            startWorker();
        }

        // Wait for all to complete
        while (running.size > 0) {
            await Promise.race(running);
        }

        clearInterval(dotInterval);
        console.log(); // newline after dots

        this.emitResults(allResults, filteredLibraries, collector);
    }

    private runWorker(libraryName: string, testTypeFilter?: string): Promise<WorkerResult | null> {
        return new Promise((resolve) => {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const workerPath = path.join(__dirname, "..", "benchmark-worker.ts");

            const args = [
                "--import", "tsx",
                workerPath,
                "--lib", libraryName,
                "-t", String(this.config.timeBudgetMs),
                "--warmup", String(this.config.warmupMs),
                "--min-iterations", String(this.config.minIterations),
            ];
            if (testTypeFilter) {
                args.push("--test", testTypeFilter);
            }

            const startTime = performance.now();

            // Print started message
            process.stdout.write(`\n  ${libraryName} started `);

            let resolved = false;
            const finish = (status: string) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeoutId);
                const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
                process.stdout.write(`\n  ${libraryName} ${status} (${elapsed}s) `);
            };

            const child = spawn(process.execPath, args, {
                stdio: ["ignore", "pipe", "pipe"],
                cwd: path.dirname(workerPath)
            });

            // Timeout: 2 minutes max per worker (or timeBudget * 100 tests * 2 safety factor)
            const timeoutMs = Math.max(120000, this.config.timeBudgetMs * 100 * 2);
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    child.kill("SIGKILL");
                    finish("TIMEOUT");
                    resolve(null);
                }
            }, timeoutMs);

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (data) => {
                stdout += data.toString();
            });

            child.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            child.on("close", (code) => {
                if (resolved) return;
                if (code !== 0) {
                    finish(`FAILED - ${stderr.trim().split("\n")[0]}`);
                    resolve(null);
                    return;
                }

                try {
                    const lines = stdout.trim().split("\n");
                    const jsonLine = lines[lines.length - 1];
                    const result = JSON.parse(jsonLine) as WorkerResult;
                    finish("done");
                    resolve(result);
                } catch (e) {
                    finish("PARSE ERROR");
                    resolve(null);
                }
            });

            child.on("error", (err) => {
                finish(`SPAWN ERROR - ${err.message}`);
                resolve(null);
            });
        });
    }

    private emitResults(
        workerResults: Map<string, WorkerResult>,
        libraries: LibraryEntry[],
        collector: BenchmarkCollector
    ): void {
        const libraryInfos: LibraryInfo[] = libraries.map(l => ({
            name: l.name,
            category: l.tags[0] ?? "runtime"
        }));

        collector.onStart(this.config, libraryInfos);

        const allTestIds = new Set<string>();
        for (const result of workerResults.values()) {
            for (const testId of Object.keys(result.results)) {
                allTestIds.add(testId);
            }
        }

        const testIdsByCategory = new Map<string, string[]>();
        for (const testId of allTestIds) {
            const category = testId.split("_")[0];
            if (!testIdsByCategory.has(category)) {
                testIdsByCategory.set(category, []);
            }
            testIdsByCategory.get(category)!.push(testId);
        }

        for (const [category, testIds] of testIdsByCategory) {
            collector.onSectionStart(category.toUpperCase());

            for (const testId of testIds.sort()) {
                const testName = testId.replace(/_/g, " ").toUpperCase();
                collector.onTestStart(testId, testName);

                const results: LibraryResult[] = libraries.map(l => {
                    const workerResult = workerResults.get(l.name);
                    if (!workerResult) {
                        return this.createSkippedResult(l.name);
                    }
                    const testResult = workerResult.results[testId];
                    if (!testResult || testResult.skipped) {
                        return this.createSkippedResult(l.name);
                    }
                    return {
                        library: l.name,
                        count: testResult.count,
                        timeMs: testResult.timeMs,
                        opsPerSec: testResult.opsPerSec,
                        skipped: false
                    };
                });

                collector.onTestComplete({
                    id: testId,
                    category,
                    testType: testId.includes("_") ? testId.split("_").slice(1).join("_") : testId,
                    name: testName,
                    results
                });
            }

            collector.onSectionComplete(category.toUpperCase());
        }

        collector.onComplete();
    }
}

interface WorkerResult {
    library: string;
    results: Record<string, { count: number; timeMs: number; opsPerSec: number; skipped: boolean }>;
    error?: string;
}
