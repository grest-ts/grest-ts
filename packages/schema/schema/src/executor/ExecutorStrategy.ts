import type {GGIssuesList} from "../issue/GGIssuesList";
import type {GGSchemaBinaryData} from "../Definition";
import {GGSchema} from "../GGSchema";

/**
 * Function signatures for schema operations
 */
export type IsFn = (value: unknown) => boolean;
export type ParseFn<T> = (value: unknown, issues: GGIssuesList, path: string, coerce?: boolean) => T | undefined;
export type CleanFn = (value: unknown, transform?: boolean) => unknown;

/**
 * Internal stringify function that takes extras array.
 * Returns JSON string with non-JSON values replaced by null.
 * Non-JSON binary data promises are pushed to extras array.
 */
export type StringifyFn = (value: unknown, extras: Promise<GGSchemaBinaryData>[]) => string | undefined;

/**
 * ExecutorStrategy - interface for execution strategies.
 *
 * Both AOT compilation and interpreter mode implement this interface,
 * returning functions that GGSchema uses to replace its default implementations.
 */
export interface ExecutorStrategy {
    /**
     * Create an `is` function for the given schema.
     */
    createIs(schema: GGSchema<any>): IsFn;

    /**
     * Create a `parse` function for the given schema.
     */
    createParse<T>(schema: GGSchema<any>): ParseFn<T>;

    /**
     * Create a `clean` function for the given schema.
     */
    createClean(schema: GGSchema<any>): CleanFn;

    /**
     * Create a `stringify` function for the given schema.
     * The function takes (value, extras) where extras collects non-JSON data.
     */
    createStringify(schema: GGSchema<any>): StringifyFn;
}
