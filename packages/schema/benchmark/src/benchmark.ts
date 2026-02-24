/**
 * Benchmark Runner
 *
 * Usage: npx tsx benchmark.ts [options]
 *
 * Examples:
 *   npx tsx benchmark.ts                          # run all libraries, all tests
 *   npx tsx benchmark.ts --tag aot                # run AOT-compiled libraries only
 *   npx tsx benchmark.ts --tag runtime            # run runtime validation libraries only
 *   npx tsx benchmark.ts --tag aot --test is      # run AOT libraries, is_* tests only
 *   npx tsx benchmark.ts -t 50 --tag aot --json   # 50ms budget, output JSON
 *   npx tsx benchmark.ts -t 50 -p 4               # 50ms budget, parallel with 4 workers
 */

import {program} from "commander";
import {Benchmarker, DEFAULT_CONFIG} from "./lib/Benchmarker";
import {ConsoleCollector} from "./lib/collector/ConsoleCollector";
import {JsonCollector} from "./lib/collector/JsonCollector";
import {BenchmarkCollector, MultiCollector} from "./lib/BenchmarkCollector";
import {LIBRARY_REGISTRY} from "./libraries/registry";
import {BENCHMARK_TEST_TYPES, LIBRARY_TAGS, TEST_CATEGORIES} from "./constants";
import {TEST_DATA} from "./tests/tests";

// ============ CLI DEFINITION ============

// Build descriptions from constants
const tagOptions = [...LIBRARY_TAGS].join(", ");
const testPrefixes = [...new Set(BENCHMARK_TEST_TYPES.map(t => t.split("_")[0]))].join(", ");

program
    .name("benchmark")
    .description("Type validation library benchmark suite")
    .requiredOption("-t, --time <ms>", "time budget per test in milliseconds")
    .option("--tag <filter>", `library tag filter: ${tagOptions}`)
    .option("--libs <filter>", "library name filter: comma-separated substrings (e.g., gg,ty)")
    .option("--test <filter>", `test type filter: ${testPrefixes} (prefix match)`)
    .option("--json [path]", "output JSON results (default: benchmark-results.json)")
    .option("-p, --parallel [n]", "run libraries in parallel (optionally limit concurrency)")
    .option("--warmup <ms>", "warmup time per test in milliseconds", "50")
    .option("--min-iterations <n>", "minimum iterations per test", "10");

// Show help if no args
if (process.argv.length <= 2) {
    program.help();
}

program.parse();

const opts = program.opts();

// ============ CONFIGURATION ============

DEFAULT_CONFIG.timeBudgetMs = parseInt(opts.time, 10);
DEFAULT_CONFIG.warmupMs = parseInt(opts.warmup, 10);
DEFAULT_CONFIG.minIterations = parseInt(opts.minIterations, 10);

// ============ RUN ============

async function run() {
    // Create benchmark
    const benchmark = new Benchmarker();

    // Add test data
    for (const category of TEST_CATEGORIES) {
        benchmark.addTestData(TEST_DATA[category]);
    }

    // Add libraries from registry
    for (const entry of LIBRARY_REGISTRY) {
        const library = await entry.loader();
        benchmark.addLibrary(entry.name, library, entry.tags);
    }

    // Create collector(s)
    const collectors: BenchmarkCollector[] = [
        new ConsoleCollector()
    ];
    if (opts.json !== undefined) {
        const jsonPath = typeof opts.json === "string" ? opts.json : "benchmark-results.json";
        collectors.push(new JsonCollector({outputPath: jsonPath}));
    }

    // Resolve filters
    const tagFilter = opts.tag;
    const libsFilter = opts.libs;
    const testTypeFilter = opts.test;

    // Run sanity tests first (throws on failure)
    benchmark.runSanityTests(tagFilter, libsFilter);

    // Determine parallelism (default: sequential = 1)
    const parallel = opts.parallel !== undefined ? parseInt(opts.parallel, 10) : 1;

    // Run benchmarks (each library in its own worker process)
    await benchmark.run(testTypeFilter, tagFilter, libsFilter, new MultiCollector(collectors), parallel);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
