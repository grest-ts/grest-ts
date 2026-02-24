import type {ExecutorStrategy, IsFn, ParseFn, CleanFn, StringifyFn} from "../ExecutorStrategy";
import {AOT_Is} from "./impl/AOT_Is";
import {AOT_Clean} from "./impl/AOT_Clean";
import {AOT_Stringify} from "./impl/AOT_Stringify";
import {AOT_Parse} from "./impl/AOT_Parse";

/**
 * AotExecutor - AOT (Ahead-of-Time) compilation strategy.
 *
 * Compiles schema validation/parsing/cleaning/stringify into optimized functions.
 */
export class AOTExecutor implements ExecutorStrategy {
    private static _instance: AOTExecutor;

    static get instance(): AOTExecutor {
        return this._instance ??= new AOTExecutor();
    }

    createIs(schema: any): IsFn {
        return new AOT_Is().compile(schema);
    }

    createParse<T>(schema: any): ParseFn<T> {
        return new AOT_Parse().compile(schema);
    }

    createClean(schema: any): CleanFn {
        return new AOT_Clean().compile(schema);
    }

    createStringify(schema: any): StringifyFn {
        return new AOT_Stringify().compile(schema);
    }
}
