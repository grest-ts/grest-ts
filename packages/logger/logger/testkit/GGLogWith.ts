import {LogLevel} from "@grest-ts/logger";
import {IGGTestWith, captureStackSourceFile, GGTestRuntime} from "@grest-ts/testkit";
import {GGLogInterceptor} from "./GGLogInterceptor";
import {LogMatcher} from "./GGLogCursor";

export class GGLogWith implements IGGTestWith {

    private readonly runtimes: GGTestRuntime[];
    private readonly matcher: LogMatcher;
    private readonly minLevel?: LogLevel;
    private readonly definedInSourceFile: string;
    private _within?: number;

    constructor(runtimes: GGTestRuntime[], matcher: LogMatcher, minLevel?: LogLevel) {
        this.runtimes = runtimes;
        this.matcher = matcher;
        this.minLevel = minLevel;
        this.definedInSourceFile = captureStackSourceFile();
    }

    /** How long `.waitFor()` waits for this, instead of its 5 s default. */
    within(timeMs: number): this {
        this._within = timeMs;
        return this;
    }

    waitTimeoutMs(): number | undefined {
        return this._within;
    }

    createInterceptor(): GGLogInterceptor {
        return new GGLogInterceptor(this.runtimes, this.matcher, this.minLevel, this.definedInSourceFile);
    }
}
