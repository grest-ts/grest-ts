import {LogLevel} from "@grest-ts/logger";
import {IGGTestWith, captureStackSourceFile, GGTestRuntime} from "@grest-ts/testkit";
import {GGLogInterceptor} from "./GGLogInterceptor";
import {LogMatcher} from "./GGLogCursor";

export class GGLogWith implements IGGTestWith {

    private readonly runtimes: GGTestRuntime[];
    private readonly matcher: LogMatcher;
    private readonly minLevel?: LogLevel;
    private readonly definedInSourceFile: string;

    constructor(runtimes: GGTestRuntime[], matcher: LogMatcher, minLevel?: LogLevel) {
        this.runtimes = runtimes;
        this.matcher = matcher;
        this.minLevel = minLevel;
        this.definedInSourceFile = captureStackSourceFile();
    }

    createInterceptor(): GGLogInterceptor {
        return new GGLogInterceptor(this.runtimes, this.matcher, this.minLevel, this.definedInSourceFile);
    }
}
