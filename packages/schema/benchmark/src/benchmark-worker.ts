#!/usr/bin/env npx tsx
/**
 * Benchmark Worker - Standalone Process
 *
 * Runs ALL tests for ONE library, outputs JSON results to stdout.
 * Uses the library registry for dynamic imports (only loads tested library).
 *
 * Usage: npx tsx benchmark-worker.ts --lib <name> [options]
 */

// Record startup time at the very beginning
const workerStartTime = performance.now();

import {program} from "commander";
import {GGBenchTestCases, TestRunner, SKIP} from "./lib/TestRunner";
import {DEFAULT_CONFIG} from "./lib/Benchmarker";
import {loadLibrary} from "./libraries/registry";
import {filterTestTypes, TEST_CATEGORIES, TestCategory} from "./constants";
import {TEST_DATA} from "./tests/tests";

// Output format
interface WorkerResult {
    library: string;
    results: Record<string, { count: number; timeMs: number; opsPerSec: number; skipped: boolean }>;
    error?: string;
}

// ============ CLI DEFINITION ============

program
    .name("benchmark-worker")
    .description("Benchmark worker process for a single library")
    .requiredOption("--lib <name>", "library name to benchmark")
    .option("--test <filter>", "test type filter")
    .option("-t, --time <ms>", "time budget per test in milliseconds", "100")
    .option("--warmup <ms>", "warmup time per test in milliseconds", "50")
    .option("--min-iterations <n>", "minimum iterations per test", "10")
    .parse();

const opts = program.opts();

function runBenchmark(fn: () => void, config: typeof DEFAULT_CONFIG, prepare?: () => void): { count: number; time: number } {
    // Warmup
    const warmupEnd = performance.now() + config.warmupMs;
    while (performance.now() < warmupEnd) {
        if (prepare) prepare();
        fn();
    }

    if (global.gc) global.gc();

    // Measure - use wall-clock time for termination to avoid prepare() overhead explosion
    let totalTime = 0;
    let count = 0;
    const wallClockStart = performance.now();

    while ((performance.now() - wallClockStart) < config.timeBudgetMs || count < config.minIterations) {
        if (prepare) prepare();
        const start = performance.now();
        fn();
        totalTime += performance.now() - start;
        count++;
    }

    return {count, time: totalTime};
}

function getTester(library: GGBenchTestCases, category: TestCategory): TestRunner | undefined {
    return library[category] as TestRunner | undefined;
}

async function main() {
    const libraryName = opts.lib;
    const testTypeFilter = opts.test;

    const config = {
        timeBudgetMs: parseInt(opts.time, 10),
        warmupMs: parseInt(opts.warmup, 10),
        minIterations: parseInt(opts.minIterations, 10),
    };

    // Load library (dynamic import via registry) and measure startup time
    let library: GGBenchTestCases;
    let startupTimeMs: number;
    try {
        library = await loadLibrary(libraryName);
        startupTimeMs = performance.now() - workerStartTime;
    } catch (e) {
        console.error(JSON.stringify({error: String(e)}));
        process.exit(1);
    }

    const testTypes = filterTestTypes(testTypeFilter);

    const output: WorkerResult = {
        library: libraryName,
        results: {}
    };

    // Record startup time (time to load the library from process start)
    output.results["startup"] = {
        count: 1,
        timeMs: startupTimeMs,
        opsPerSec: 1000 / startupTimeMs,
        skipped: false
    };

    // Run all test categories and types
    for (const category of TEST_CATEGORIES) {
        const categoryData = TEST_DATA[category];
        const tester = getTester(library, category);

        for (const testType of testTypes) {
            const testId = `${category}_${testType}`;

            if (!tester) {
                output.results[testId] = {count: 0, timeMs: 0, opsPerSec: 0, skipped: true};
                continue;
            }

            tester.setObj(categoryData.correctObj, categoryData.wrongObj);
            tester.before();

            // Check if test is supported
            tester.prepare(testType);
            const testResult = tester.run(testType);
            if (testResult === SKIP) {
                output.results[testId] = {count: 0, timeMs: 0, opsPerSec: 0, skipped: true};
                continue;
            }

            // Run benchmark
            tester.setObj(categoryData.correctObj, categoryData.wrongObj);
            const bench = runBenchmark(
                () => tester.run(testType),
                config,
                () => tester.prepare(testType)
            );

            output.results[testId] = {
                count: bench.count,
                timeMs: bench.time,
                opsPerSec: bench.count / bench.time * 1000,
                skipped: false
            };
        }
    }

    // Output JSON to stdout
    console.log(JSON.stringify(output));
}

main().catch(err => {
    console.error(JSON.stringify({error: String(err)}));
    process.exit(1);
});
