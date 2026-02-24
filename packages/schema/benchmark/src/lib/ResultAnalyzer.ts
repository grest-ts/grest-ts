import {BenchmarkRun, LibraryResult, TestResult} from "./BenchmarkSchema";

/**
 * Configuration for ranking algorithm.
 */
export interface RankingConfig {
    tieThreshold: number;  // Results within this ratio of fastest are ties (default 1.10 = 10%)
    winPoints: number;     // Points for a win (default 2)
    tiePoints: number;     // Points for a tie (default 1)
}

const DEFAULT_RANKING_CONFIG: RankingConfig = {
    tieThreshold: 1.10,
    winPoints: 2,
    tiePoints: 1
};


/**
 * Analyzer for calculating comparative metrics from raw benchmark results.
 */
export class ResultAnalyzer {
    constructor(private config: RankingConfig = DEFAULT_RANKING_CONFIG) {
    }

    /**
     * Rank results for a single test.
     * Returns results sorted by ops/sec (fastest first) with rank and ratio.
     */
    rankTestResults(results: LibraryResult[]): RankedLibraryResult[] {
        const validResults = results.filter(r => !r.skipped && r.timeMs > 0);
        const skippedResults = results.filter(r => r.skipped || r.timeMs <= 0);

        // Sort by ops/sec descending (higher is better)
        const sorted = [...validResults].sort((a, b) => b.opsPerSec - a.opsPerSec);
        const fastestOps = sorted[0]?.opsPerSec ?? 1;

        // Count winners (within tie threshold)
        const winnerCount = sorted.filter(r => fastestOps / r.opsPerSec <= this.config.tieThreshold).length;
        const isTie = winnerCount > 1;

        const ranked: RankedLibraryResult[] = sorted.map((result, index) => {
            const ratio = fastestOps / result.opsPerSec;
            const isWinner = ratio <= this.config.tieThreshold;
            const rank = isWinner ? 1 : (winnerCount + (index - winnerCount) + 1);

            return {
                ...result,
                rank,
                ratio,
                isWinner,
                isTie: isWinner && isTie
            };
        });

        // Add skipped results at the end
        for (const result of skippedResults) {
            ranked.push({
                ...result,
                rank: -1,
                ratio: -1,
                isWinner: false,
                isTie: false
            });
        }

        return ranked;
    }

    /**
     * Rank a complete test result.
     */
    rankTest(test: TestResult): RankedTestResult {
        const rankedResults = this.rankTestResults(test.results);
        const validResults = rankedResults.filter(r => r.rank > 0);
        const fastest = validResults[0];

        return {
            id: test.id,
            category: test.category,
            testType: test.testType,
            name: test.name,
            results: rankedResults,
            fastestOps: fastest?.opsPerSec ?? 0,
            fastestCount: fastest?.count ?? 0
        };
    }

    /**
     * Calculate summary statistics for all libraries across all tests.
     */
    summarize(run: BenchmarkRun): BenchmarkSummary {
        const libraryStats = new Map<string, {
            totalOps: number;
            totalTimeMs: number;
            points: number;
            wins: number;
        }>();

        // Initialize stats for all libraries
        for (const lib of run.libraries) {
            libraryStats.set(lib.name, {
                totalOps: 0,
                totalTimeMs: 0,
                points: 0,
                wins: 0
            });
        }

        // Accumulate stats from each test
        for (const test of run.tests) {
            const ranked = this.rankTestResults(test.results);
            const winnerCount = ranked.filter(r => r.isWinner).length;
            const isTie = winnerCount > 1;

            for (const result of ranked) {
                const stats = libraryStats.get(result.library);
                if (!stats) continue;

                if (!result.skipped && result.timeMs > 0) {
                    stats.totalOps += result.count;
                    stats.totalTimeMs += result.timeMs;
                }

                if (result.isWinner) {
                    stats.points += isTie ? this.config.tiePoints : this.config.winPoints;
                    stats.wins += 1;
                }
            }
        }

        // Convert to array and sort by total ops
        const summaries: LibrarySummary[] = [];
        for (const [library, stats] of Array.from(libraryStats.entries())) {
            summaries.push({
                library,
                totalOps: stats.totalOps,
                totalTimeMs: stats.totalTimeMs,
                points: stats.points,
                wins: stats.wins,
                rank: 0,  // Will be set below
                ratio: 0  // Will be set below
            });
        }

        // Sort by total ops descending
        summaries.sort((a, b) => b.totalOps - a.totalOps);

        // Calculate ranks and ratios
        const highestOps = summaries[0]?.totalOps ?? 1;
        summaries.forEach((summary, index) => {
            summary.rank = index + 1;
            summary.ratio = highestOps / (summary.totalOps || 1);
        });

        return {
            libraries: summaries,
            totalTests: run.tests.length
        };
    }
}


/**
 * Library result enriched with comparative metrics.
 * Calculated by ResultAnalyzer when all results are available.
 */
export interface RankedLibraryResult extends LibraryResult {
    rank: number;
    ratio: number;      // How many times slower than fastest (1.0 = fastest)
    isWinner: boolean;  // Within tie threshold of fastest
    isTie: boolean;     // Multiple winners (tie situation)
}

/**
 * Test result with ranked libraries.
 */
export interface RankedTestResult extends Omit<TestResult, 'results'> {
    results: RankedLibraryResult[];
    fastestOps: number;
    fastestCount: number;
}

/**
 * Per-library summary statistics.
 */
export interface LibrarySummary {
    library: string;
    totalOps: number;
    totalTimeMs: number;
    points: number;
    wins: number;
    rank: number;       // By total ops
    ratio: number;      // vs fastest total ops
}

/**
 * Complete benchmark summary with rankings.
 */
export interface BenchmarkSummary {
    libraries: LibrarySummary[];
    totalTests: number;
}