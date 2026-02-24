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
    [K in Columns[number]['nameAs']]: Extract<Columns[number], { nameAs: K }>['type']
}


// --------------------------------------------------------------------

type _checkIfExistsInOtherFields<Rest extends any[], Expr> =
    Rest extends []
        ? Expr
        : Expr extends { nameAs: string } ?
            Expr["nameAs"] extends (Rest extends { nameAs: infer A }[] ? A : never)
                ? `'${Expr["nameAs"]}' already exists in columns!`
                : Expr
            : Expr extends { nameAs: unknown } ?
                `Is missing column name. Add .as('name')`
                : Expr

type _checkIfExistsInResult<Result, Expr> =
    Expr extends { nameAs: string } ?
        Expr["nameAs"] extends keyof Result
            ? `'${Expr["nameAs"]}' already exists in result columns!`
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
