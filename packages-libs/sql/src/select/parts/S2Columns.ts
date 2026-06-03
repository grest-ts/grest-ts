import {WhereMethods} from "./S2Where";
import {Expr} from "../../SqlExpression";
import {AliasedTable, NotUsingWithPart} from "../../Types";

export interface ColumnsMethods<Result, Tables> {

    distinct(): ColumnsMethods<Result, Tables>

    allColumnsFrom<TableRef, Entity, Result2 = Result & Entity>(table: AliasedTable<string, TableRef, Entity, any, NotUsingWithPart>): ColumnsMethods<Result2, Tables> & WhereMethods<Result2, Tables>

    one(): WhereMethods<Result & { one: 1 }, Tables>

    columns<
        TableRef,
        Columns extends Expr<TableRef, string, any>[]
    >(
        //...columns: Columns - this will enable seeing sources of Result object properties.
        ...columns: isColumnOkToAdd<Result, Tables, Columns>
    ): WhereMethods<Result & ExtractObj<Columns>, Tables>

}

// --------------------------------------------------------------------

/**
 * Take array of Col-s and convert to Record<key, value> & ... object.
 */
export type ExtractObj<Columns extends Expr<any, string, any>[]> = {
    [K in NonNullable<Columns[number]['nameAs']> & (string | number | symbol)]: _ColumnTypeByName<Columns[number], K>
}

type _ColumnTypeByName<Column, K> = Column extends { nameAs: infer N, type: infer T }
    ? K extends NonNullable<N> ? T : never
    : never


// --------------------------------------------------------------------

type _checkIfExistsInOtherFields<Rest extends any[], Expr> =
    Rest extends []
        ? Expr
        : Expr extends { nameAs: infer N } ?
            [NonNullable<N>] extends [string] ?
                NonNullable<N> extends (Rest extends { nameAs: infer A }[] ? NonNullable<A> : never)
                    ? `'${NonNullable<N>}' already exists in columns!`
                    : Expr
                : `Is missing column name. Add .as('name')`
            : Expr

type _checkIfExistsInResult<Result, Expr> =
    Expr extends { nameAs: infer N } ?
        [NonNullable<N>] extends [string] ?
            NonNullable<N> extends keyof Result
                ? `'${NonNullable<N> & string}' already exists in result columns!`
                : Expr
            : Expr
        : Expr

type _checkThatTableIsReferenced<Tables, Expr> =
    Expr extends { tableRef: string } ?
        Expr["tableRef"] extends keyof Tables
            ? Expr
            : `'${Expr["tableRef"]}' is not used in this query!`
        : Expr

type isColumnOkToAdd<Result, Tables, ColumnExpressions> =
    ColumnExpressions extends []
        ? ColumnExpressions
        : ColumnExpressions extends [...(infer Rest), infer A]
            ? [...isColumnOkToAdd<Result, Tables, Rest>, _checkIfExistsInOtherFields<Rest, _checkIfExistsInResult<Result, _checkThatTableIsReferenced<Tables, A>>>]
            : ColumnExpressions;


// --------------------------------------------------------------------
