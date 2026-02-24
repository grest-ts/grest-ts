/**
 * Raw benchmark data schema - pure measurements without comparative metrics.
 * Rank, ratio, points, wins are calculated by reporters/analyzers, not stored here.
 */

export interface BenchmarkConfig {
    timeBudgetMs: number;
    warmupMs: number;
    minIterations: number;
}

export interface LibraryInfo {
    name: string;
    category: "aot" | "runtime" | "network" | "val";
}

/**
 * Raw measurement for a single library on a single test.
 * No comparative metrics - just what was measured.
 */
export interface LibraryResult {
    library: string;
    count: number;      // Number of operations completed
    timeMs: number;     // Time taken in milliseconds
    opsPerSec: number;  // Derived: count / timeMs * 1000
    skipped?: boolean;  // True if test was skipped (N/A)
}

/**
 * Results for a single test across all libraries.
 */
export interface TestResult {
    id: string;           // e.g., "simple_is_correct"
    category: string;     // e.g., "simple", "nested", "bigArray"
    testType: string;     // e.g., "is_correct", "parse_wrong", "stringify_correct"
    name: string;         // Human-readable name, e.g., "SIMPLE IS - Valid"
    results: LibraryResult[];
}

/**
 * Complete benchmark run data - raw measurements only.
 */
export interface BenchmarkRun {
    timestamp: string;    // ISO timestamp
    config: BenchmarkConfig;
    libraries: LibraryInfo[];
    tests: TestResult[];
}
