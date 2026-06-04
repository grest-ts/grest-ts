import {BenchmarkConfig, LibraryInfo, TestResult, BenchmarkRun} from "./BenchmarkSchema";

/**
 * Interface for collecting benchmark results.
 * Supports streaming - results are emitted as they complete.
 * Implementations can render to console, write to file, etc.
 */
export interface BenchmarkCollector {
    /**
     * Set libraries that only report first error (not all errors).
     */
    setFirstErrorOnly(libraries: Set<string>): void;

    /**
     * Called when benchmark run starts.
     */
    onStart(config: BenchmarkConfig, libraries: LibraryInfo[]): void;

    /**
     * Called when a new section/category begins.
     */
    onSectionStart(name: string): void;

    /**
     * Called when a test begins (before running).
     */
    onTestStart(testId: string, testName: string): void;

    /**
     * Called when a test completes with results for all libraries.
     */
    onTestComplete(result: TestResult): void;

    /**
     * Called when a section/category completes.
     */
    onSectionComplete(name: string): void;

    /**
     * Called when all tests are complete.
     * Returns the complete benchmark run data.
     */
    onComplete(): BenchmarkRun;
}

/**
 * Base collector that accumulates results.
 * Extend this for specific output formats.
 */
export abstract class BaseBenchmarkCollector implements BenchmarkCollector {
    protected config!: BenchmarkConfig;
    protected libraries: LibraryInfo[] = [];
    protected tests: TestResult[] = [];
    protected startTime!: string;
    protected firstErrorOnly: Set<string> = new Set();

    setFirstErrorOnly(libraries: Set<string>): void {
        this.firstErrorOnly = libraries;
    }

    onStart(config: BenchmarkConfig, libraries: LibraryInfo[]): void {
        this.config = config;
        this.libraries = libraries;
        this.tests = [];
        this.startTime = new Date().toISOString();
    }

    onSectionStart(name: string): void {
        // Override in subclasses if needed
    }

    onTestStart(testId: string, testName: string): void {
        // Override in subclasses if needed
    }

    onTestComplete(result: TestResult): void {
        this.tests.push(result);
    }

    onSectionComplete(name: string): void {
        // Override in subclasses if needed
    }

    onComplete(): BenchmarkRun {
        return {
            timestamp: this.startTime,
            config: this.config,
            libraries: this.libraries,
            tests: this.tests
        };
    }
}

/**
 * Multiplexer that forwards events to multiple collectors.
 */
export class MultiCollector implements BenchmarkCollector {
    private collectors: BenchmarkCollector[]
    constructor(collectors: BenchmarkCollector[]) {
        this.collectors = collectors
    }

    setFirstErrorOnly(libraries: Set<string>): void {
        for (const c of this.collectors) c.setFirstErrorOnly(libraries);
    }

    onStart(config: BenchmarkConfig, libraries: LibraryInfo[]): void {
        for (const c of this.collectors) c.onStart(config, libraries);
    }

    onSectionStart(name: string): void {
        for (const c of this.collectors) c.onSectionStart(name);
    }

    onTestStart(testId: string, testName: string): void {
        for (const c of this.collectors) c.onTestStart(testId, testName);
    }

    onTestComplete(result: TestResult): void {
        for (const c of this.collectors) c.onTestComplete(result);
    }

    onSectionComplete(name: string): void {
        for (const c of this.collectors) c.onSectionComplete(name);
    }

    onComplete(): BenchmarkRun {
        // Return from first collector (they should all have the same data)
        return this.collectors[0].onComplete();
    }
}
