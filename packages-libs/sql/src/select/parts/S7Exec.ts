import {AliasedTable, NotUsingWithPart, SelectExecutor, SqlSelectQuery} from "../../Types";
import {Expr} from "../../SqlExpression";
import {UnionMethods} from "./S0Union";

export interface ExecMethods<Result> extends SqlSelectQuery<Result>, UnionMethods<Result> {

    forUpdate(): ExecMethods<Result>

    asScalar<Alias extends string>(
        alias: Alias & ScalarSubQueryAllowsOnlyOneColumn<Alias, Result> extends never ? "Scalar subquery allows only 1 column!" : Alias
    ): Expr<never, Alias, Result[keyof Result]>

    as<Alias extends string>(alias: Alias): AliasedTable<Alias, `(SUBQUERY) as ${Alias}`, Result, object, NotUsingWithPart>

    /**
     * Example of an executor method.
     * Notice that it can force existence of other arguments in the exec call. In this case forcing ctx to be added.
     * async <Result>(sql: string, ctx: Ctx): Promise<Result> => {
     *     return someDb.query(ctx, sql);
     * }
     */
    exec<Args extends any[]>(executor: SelectExecutor<Result, Args>, ...args: Args): Promise<Result[]>

    /**
     * Same as exec, but returns one row
     */
    execOne<Args extends any[]>(executor: SelectExecutor<Result, Args>, ...args: Args): Promise<Result>

}

/**
 * Basically checks that Result would have only one column defined.
 */
type ScalarSubQueryAllowsOnlyOneColumn<Result, T, Keys extends keyof any = keyof T> =
    Keys extends any
        ? T extends Record<Keys, any>
            ? Exclude<keyof T, Keys> extends never
                ? Result
                : never
            : never
        : never;
