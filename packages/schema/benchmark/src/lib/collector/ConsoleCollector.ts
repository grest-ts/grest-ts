import {BaseBenchmarkCollector} from "../BenchmarkCollector";
import {BenchmarkConfig, BenchmarkRun, LibraryInfo, TestResult} from "../BenchmarkSchema";
import {BenchmarkSummary, RankedTestResult, ResultAnalyzer} from "../ResultAnalyzer";

/**
 * Console colors for output formatting.
 */
const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    win: "\x1b[92m",      // bright green
    tie: "\x1b[32m",      // dark green
    teal: "\x1b[96m",
    blue: "\x1b[94m",
    purple: "\x1b[95m",
    yellow: "\x1b[93m",
    red: "\x1b[91m",
    gray: "\x1b[90m",
};

/**
 * Get color based on ratio (how much slower than fastest).
 */
function getColor(ratio: number): string {
    if (ratio < 2) return colors.teal;
    if (ratio < 3) return colors.blue;
    if (ratio < 5) return colors.purple;
    if (ratio < 10) return colors.yellow;
    return colors.red;
}

/**
 * Format count to fit 4 chars: 1-9999 as-is, then k/M.
 */
function formatCount(n: number): string {
    if (n < 1000) return Math.round(n).toString();
    if (n < 10000) return (n / 1000).toFixed(1) + "k";
    if (n < 1000000) return Math.floor(n / 1000) + "k";
    if (n < 10000000) return (n / 1000000).toFixed(1) + "M";
    return Math.floor(n / 1000000) + "M";
}

/**
 * Format ops/s to fit 5 chars.
 */
function formatOps(ops: number): string {
    if (ops < 1000) return Math.round(ops).toString();
    if (ops < 10000) return (ops / 1000).toFixed(1) + "k";
    if (ops < 1000000) return Math.floor(ops / 1000) + "k";
    if (ops < 10000000) return (ops / 1000000).toFixed(1) + "M";
    if (ops < 1000000000) return Math.floor(ops / 1000000) + "M";
    return (ops / 1000000000).toFixed(1) + "B";
}

/**
 * Format large numbers with units.
 */
function formatLargeNum(n: number): string {
    if (n >= 1000000000) return (n / 1000000000).toFixed(2) + "B";
    if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
    if (n >= 1000) return (n / 1000).toFixed(2) + "k";
    return n.toString();
}

/**
 * Collector that outputs results to console as they stream in.
 */
export class ConsoleCollector extends BaseBenchmarkCollector {
    private analyzer = new ResultAnalyzer();
    private testNum = 0;
    private rankedTests: RankedTestResult[] = [];

    onStart(config: BenchmarkConfig, libraries: LibraryInfo[]): void {
        super.onStart(config, libraries);
        this.testNum = 0;
        this.rankedTests = [];

        this.printSectionHeader("BENCHMARK");
        console.log(`Time budget: ${config.timeBudgetMs}ms per test`);
        console.log(`Warmup: ${config.warmupMs}ms, Min iterations: ${config.minIterations}\n`);
    }

    onSectionStart(name: string): void {
        this.printSectionHeader(name);
    }

    onTestStart(testId: string, testName: string): void {
        this.testNum++;
        this.printHeader(`${this.testNum}. ${testName}`);
    }

    onTestComplete(result: TestResult): void {
        super.onTestComplete(result);

        // Rank and display results
        const ranked = this.analyzer.rankTest(result);
        this.rankedTests.push(ranked);
        this.printTestResults(ranked);
    }

    onSectionComplete(name: string): void {
        console.log("");
    }

    onComplete(): BenchmarkRun {
        const run = super.onComplete();
        const summary = this.analyzer.summarize(run);

        this.printOverallRanking(this.rankedTests, summary);
        this.printTotalThroughput(summary);
        this.printFirstErrorOnlyNote();

        return run;
    }

    // ============ Printing Helpers ============

    private printHeader(title: string): void {
        console.log("\n" + "─".repeat(70));
        console.log(title);
        console.log("─".repeat(70));
    }

    private printSectionHeader(title: string): void {
        console.log("\n" + "=".repeat(70));
        console.log(title);
        console.log("=".repeat(70));
    }

    private printTestResults(ranked: RankedTestResult): void {
        console.log(`(${this.config.timeBudgetMs}ms budget per library)`);

        for (const result of ranked.results) {
            const displayName = this.getLibraryDisplayName(result.library);
            if (result.skipped || result.rank < 0) {
                console.log(`${displayName.padEnd(20)}      N/A`);
                continue;
            }

            const mult = result.ratio <= 1.01 ? "" : ` (${result.ratio.toFixed(1)}x slower)`;
            console.log(
                `${displayName.padEnd(20)} ` +
                `${result.count.toLocaleString().padStart(10)}  ` +
                `${result.opsPerSec.toFixed(0).padStart(12)}/s  ` +
                `${result.timeMs.toFixed(1).padStart(6)}ms${mult}`
            );
        }
    }

    private printOverallRanking(rankedTests: RankedTestResult[], summary: BenchmarkSummary): void {
        this.printSectionHeader("OVERALL RANKING");

        // Sort libraries by points for column order
        const sortedLibraries = [...summary.libraries].sort((a, b) => b.points - a.points);

        const maxLibNameLen = Math.max(...sortedLibraries.map(s => this.getLibraryDisplayName(s.library).length), 10);
        const libColWidth = maxLibNameLen + 2;

        const libHeaders = sortedLibraries.map(s =>
            this.getLibraryDisplayName(s.library).padStart(libColWidth)
        ).join("");

        const formatTestId = (id: string) => id.replace(/_/g, " ");
        const maxTestNameLen = Math.max(...rankedTests.map(t => formatTestId(t.id).length), 10);
        const testColWidth = maxTestNameLen + 2;
        const statsColWidth = 14;

        const printHeader = () => {
            console.log(`\n${"Test".padEnd(testColWidth)}${"".padEnd(statsColWidth)}${libHeaders}`);
            console.log("─".repeat(testColWidth + statsColWidth + sortedLibraries.length * libColWidth));
        };

        printHeader();

        let lastCategory = "";
        let linesSinceHeader = 0;
        const LINES_BEFORE_REPRINT = 30;

        for (const test of rankedTests) {
            const currentCategory = test.id.split("_")[0];
            if (lastCategory && currentCategory !== lastCategory) {
                console.log("");
                linesSinceHeader++;
                if (linesSinceHeader >= LINES_BEFORE_REPRINT) {
                    printHeader();
                    linesSinceHeader = 0;
                }
            }
            lastCategory = currentCategory;
            linesSinceHeader++;

            // Build result columns
            const values = sortedLibraries.map(libSummary => {
                const result = test.results.find(r => r.library === libSummary.library);
                if (!result) return "?".padStart(libColWidth);

                if (result.skipped || result.rank < 0) {
                    return `${colors.gray}${"N/A".padStart(libColWidth)}${colors.reset}`;
                }

                const placeStr = result.rank > 0 ? `${result.rank} - ` : "";
                let valueStr: string;
                if (result.isWinner) {
                    valueStr = result.isTie ? "TIE" : "WIN";
                } else {
                    valueStr = result.ratio >= 100
                        ? Math.round(result.ratio) + "x"
                        : result.ratio.toFixed(1) + "x";
                }

                const valueColor = result.isWinner ? (result.isTie ? colors.tie : colors.win) : getColor(result.ratio);
                const display = `${result.rank} - ${valueStr}`;
                const padding = " ".repeat(Math.max(0, libColWidth - display.length));

                return `${padding}${colors.gray}${placeStr}${colors.reset}${valueColor}${valueStr}${colors.reset}`;
            }).join("");

            const statsText = `${formatCount(test.fastestCount).padStart(4)} ${(formatOps(test.fastestOps) + "/s").padStart(7)}`;
            const statsStr = `${colors.gray}${statsText} ${colors.reset}`;

            console.log(`${formatTestId(test.id).padEnd(testColWidth)}${statsStr}${values}`);
        }

        // Print summary rows
        console.log("─".repeat(testColWidth + statsColWidth + sortedLibraries.length * libColWidth));

        const rankColors = [colors.win, colors.teal, colors.blue, colors.purple, colors.yellow, colors.red];

        const pointsRow = sortedLibraries.map((s, i) => {
            const points = s.points.toString().padStart(libColWidth);
            const color = rankColors[Math.min(i, rankColors.length - 1)];
            return `${color}${colors.bold}${points}${colors.reset}`;
        }).join("");

        const winsRow = sortedLibraries.map((s, i) => {
            const wins = (s.wins + " wins").padStart(libColWidth);
            const color = rankColors[Math.min(i, rankColors.length - 1)];
            return `${color}${wins}${colors.reset}`;
        }).join("");

        console.log(`${"POINTS".padEnd(testColWidth)}${"".padEnd(statsColWidth)}${pointsRow}`);
        console.log(`${"WINS".padEnd(testColWidth)}${"".padEnd(statsColWidth)}${winsRow}`);

        console.log(`\n${colors.win}WIN${colors.reset} = 2 points, ${colors.tie}TIE${colors.reset} = 1 point each (within 10% of fastest), Nx = times slower`);
    }

    private printTotalThroughput(summary: BenchmarkSummary): void {
        // Sort by total ops
        const sortedByOps = [...summary.libraries].sort((a, b) => b.totalOps - a.totalOps);

        console.log("\n" + "═".repeat(90));
        console.log(`${colors.bold}TOTAL THROUGHPUT (sum of all tests)${colors.reset}`);
        console.log("═".repeat(90));

        const rankCol = 8;
        const nameCol = 24;
        const opsCol = 16;
        const ratioCol = 14;
        const pointsCol = 10;
        const winsCol = 10;
        const totalWidth = rankCol + nameCol + opsCol + ratioCol + pointsCol + winsCol + 2;

        console.log(`${"Rank".padStart(rankCol)}  ${"Library".padEnd(nameCol)}${"Total Ops".padStart(opsCol)}${"vs Fastest".padStart(ratioCol)}${"Points".padStart(pointsCol)}${"Wins".padStart(winsCol)}`);
        console.log("─".repeat(totalWidth));

        for (const stat of sortedByOps) {
            const ratioStr = stat.ratio.toFixed(2) + "x";
            const ratioColor = stat.ratio <= 1.10 ? colors.win : getColor(stat.ratio);
            const rankColor = stat.rank === 1 ? colors.win : colors.gray;

            const rankDisplay = `${rankColor}${("#" + stat.rank).padStart(rankCol)}${colors.reset}`;
            const nameStr = this.getLibraryDisplayName(stat.library).padEnd(nameCol);
            const opsStr = formatLargeNum(stat.totalOps).padStart(opsCol);
            const ratioDisplay = `${ratioColor}${ratioStr.padStart(ratioCol)}${colors.reset}`;
            const pointsStr = stat.points.toString().padStart(pointsCol);
            const winsStr = stat.wins.toString().padStart(winsCol);

            console.log(`${rankDisplay}  ${nameStr}${opsStr}${ratioDisplay}${pointsStr}${winsStr}`);
        }

        console.log("─".repeat(totalWidth));
    }

    private getLibraryDisplayName(name: string): string {
        return this.firstErrorOnly.has(name) ? name + "*" : name;
    }

    private printFirstErrorOnlyNote(): void {
        if (this.firstErrorOnly.size === 0) return;

        const libs = [...this.firstErrorOnly].sort();
        console.log(`\n${colors.gray}* First-error-only: ${libs.join(", ")}${colors.reset}`);
    }
}
