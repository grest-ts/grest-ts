import type {ExecutorStrategy, IsFn, ParseFn, CleanFn, StringifyFn} from "../ExecutorStrategy";
import type {AnyStandardSchemaDef} from "../../Definition";
import {CODE_Is} from "./impl/CODE_Is";
import {CODE_Clean} from "./impl/CODE_Clean";
import {CODE_Parse} from "./impl/CODE_Parse";
import {CODE_Stringify} from "./impl/CODE_Stringify";

/**
 * InterpreterExecutor - interpreter-based execution strategy.
 *
 * Creates functions that delegate to interpreter instances.
 * Used as fallback when AOT compilation is not available.
 */
export class StandardExecutor implements ExecutorStrategy {
    private static _instance: StandardExecutor;

    static get instance(): StandardExecutor {
        return this._instance ??= new StandardExecutor();
    }

    createIs(schema: any): IsFn {
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;
        return (value: unknown) => CODE_Is.instance.is(def, value);
    }

    createParse<T>(schema: any): ParseFn<T> {
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;
        return (value, issues, path, coerce) =>
            CODE_Parse.instance.parse(def, value, issues, path, coerce) as T | undefined;
    }

    createClean(schema: any): CleanFn {
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;
        return (value, transform) => {
            if (value === undefined || value === null) return value;
            return CODE_Clean.instance.clean(def, value, transform);
        };
    }

    createStringify(schema: any): StringifyFn {
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;
        return (value, extras) => CODE_Stringify.instance.stringify(def, value, extras, '');
    }
}
