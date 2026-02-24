import * as fs from "fs";
import * as path from "path";
import {BaseBenchmarkCollector} from "../BenchmarkCollector";
import {BenchmarkRun} from "../BenchmarkSchema";
import {ResultAnalyzer} from "../ResultAnalyzer";

export interface JsonCollectorOptions {
    outputPath?: string;           // Path to write JSON file (default: benchmark-results.json)
    includeAnalysis?: boolean;     // Include ranked results and summary (default: true)
    prettyPrint?: boolean;         // Pretty print JSON (default: true)
}

/**
 * Collector that writes benchmark results to a JSON file.
 * Raw measurements are always included; analysis (ranks, summary) is optional.
 */
export class JsonCollector extends BaseBenchmarkCollector {
    private options: Required<JsonCollectorOptions>;
    private analyzer = new ResultAnalyzer();

    constructor(options: JsonCollectorOptions = {}) {
        super();
        this.options = {
            outputPath: options.outputPath ?? "benchmark-results.json",
            includeAnalysis: options.includeAnalysis ?? true,
            prettyPrint: options.prettyPrint ?? true
        };
    }

    onComplete(): BenchmarkRun {
        const run = super.onComplete();

        // Build output object
        const output: any = {
            ...run
        };

        // Optionally include analysis
        if (this.options.includeAnalysis) {
            const summary = this.analyzer.summarize(run);
            output.analysis = {
                summary,
                rankedTests: run.tests.map(test => this.analyzer.rankTest(test))
            };
        }

        // Write to file
        const jsonStr = this.options.prettyPrint
            ? JSON.stringify(output, null, 2)
            : JSON.stringify(output);

        const outputPath = path.resolve(this.options.outputPath);
        fs.writeFileSync(outputPath, jsonStr, "utf-8");
        console.log(`\nBenchmark results written to: ${outputPath}`);

        return run;
    }
}

/**
 * Collector that streams results to a JSONL (JSON Lines) file.
 * Each test result is written as a separate line as it completes.
 * Useful for large benchmark runs or when you want incremental output.
 */
export class JsonLinesCollector extends BaseBenchmarkCollector {
    private outputPath: string;
    private writeStream: fs.WriteStream | null = null;

    constructor(outputPath: string = "benchmark-results.jsonl") {
        super();
        this.outputPath = path.resolve(outputPath);
    }

    onStart(config: any, libraries: any[]): void {
        super.onStart(config, libraries);

        // Open write stream
        this.writeStream = fs.createWriteStream(this.outputPath, {flags: "w", encoding: "utf-8"});

        // Write header line
        this.writeStream.write(JSON.stringify({
            type: "header",
            timestamp: this.startTime,
            config: this.config,
            libraries: this.libraries
        }) + "\n");
    }

    onTestComplete(result: any): void {
        super.onTestComplete(result);

        // Write test result line
        if (this.writeStream) {
            this.writeStream.write(JSON.stringify({
                type: "test",
                ...result
            }) + "\n");
        }
    }

    onComplete(): BenchmarkRun {
        const run = super.onComplete();

        // Write footer line with summary
        if (this.writeStream) {
            const analyzer = new ResultAnalyzer();
            const summary = analyzer.summarize(run);

            this.writeStream.write(JSON.stringify({
                type: "summary",
                summary
            }) + "\n");

            this.writeStream.end();
            this.writeStream = null;
        }

        console.log(`\nBenchmark results streamed to: ${this.outputPath}`);
        return run;
    }
}
