import {AliasedTable, isAliasAlreadyUsed, isTableReferenced, Key, NotUsingWithPart, SQL_BOOL} from "../../Types";
import {Expr, Over} from "../../SqlExpression";
import {ColumnsMethods} from "./S2Columns";

export interface JoinMethods<Aliases, AliasesFromWith, Tables> extends ColumnsMethods<{}, Tables> {

    join<
        Alias extends string,
        TableRef extends `${string} as ${Alias}`,
        RefAlias extends NotUsingWithPart | string,
        ColTableRef extends string
    >(
        table: isRefAliasInAliasesFromWith<AliasesFromWith, RefAlias, isAliasAlreadyUsed<Aliases & AliasesFromWith, Alias, AliasedTable<Alias, TableRef, object, object, RefAlias>>>,
        condition: isConditionUsingJoinedTable<TableRef, ColTableRef, isTableReferenced<Tables & Key<TableRef>, Key<ColTableRef>, Expr<ColTableRef, unknown, SQL_BOOL>>>
    ): JoinMethods<Aliases & Key<Alias>, AliasesFromWith, Tables & Key<TableRef>>

    leftJoin<
        Alias extends string,
        TableRef extends `${string} as ${Alias}`,
        RefAlias extends NotUsingWithPart | string,
        ColTableRef extends string
    >(
        table: isRefAliasInAliasesFromWith<AliasesFromWith, RefAlias, isAliasAlreadyUsed<Aliases & AliasesFromWith, Alias, AliasedTable<Alias, TableRef, object, object, RefAlias>>>,
        condition: isConditionUsingJoinedTable<TableRef, ColTableRef, isTableReferenced<Tables & Key<TableRef>, Key<ColTableRef>, Expr<ColTableRef, unknown, SQL_BOOL>>>
    ): JoinMethods<Aliases & Key<Alias>, AliasesFromWith, Tables & Key<TableRef>>

    window<
        WindowName extends string,
        UsedTablesRef extends string
    >(
        name: isAliasAlreadyUsed<Aliases & AliasesFromWith, WindowName, WindowName>,
        func: (builder: Over<never>) => Over<UsedTablesRef>
    ): JoinMethods<Aliases & Key<WindowName>, AliasesFromWith, Tables & Key<`(window) as ${WindowName}`>>

}

type isConditionUsingJoinedTable<TableRef, ColTableRef, OUT> = TableRef extends ColTableRef ? OUT : "Join condition should use columns from the joined table!"

type isRefAliasInAliasesFromWith<AliasesFromWith, RefAlias, OUT> = RefAlias extends NotUsingWithPart | string & keyof AliasesFromWith ? OUT : `Alias '${RefAlias extends string ? RefAlias : RefAlias extends NotUsingWithPart ? "NOT_REFERENCED" : "???"}' is not defined by any of the with queries!`