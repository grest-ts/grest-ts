import {AliasedTable, isColumnOkToUse, isTableReferenced, Key, NotUsingWithPart, OrderByStructure, SQL_BOOL, SqlQuery} from "../Types";
import {Expr} from "../SqlExpression";

export interface GatewayUpdateWhereMethods<Entity> {

    where(obj: Partial<Entity>): GatewayUpdateOrderByMethods<Entity>

}

export interface GatewayUpdateOrderByMethods<Entity> extends UpdateLimitMethods {

    orderBy(fields: keyof Entity): UpdateLimitMethods

}

export interface UpdateSetMethods<Entity, Tables> {

    set(value: PartialAndCheckExpr<Entity, Tables>): UpdateWhereMethods<Tables>

    join<
        Alias extends string,
        TableRef extends `${string} as ${Alias}`,
    >(
        table: AliasedTable<Alias, TableRef, object, object, NotUsingWithPart>
    ): UpdateSetMethods<Entity, Tables & Key<TableRef>>;

}

type PartialAndCheckExpr<Entity, Tables> = {
    [P in keyof Entity]?: Entity[P] | Expr<keyof Tables, string, Entity[P]>
};

export interface UpdateWhereMethods<Tables> {

    noWhere(): UpdateOrderByMethods<Tables>

    where<
        T1 extends string,
        T2 extends string = never,
        T3 extends string = never,
        T4 extends string = never,
        T5 extends string = never,
        T6 extends string = never,
        T7 extends string = never,
        T8 extends string = never,
        T9 extends string = never,
        T10 extends string = never,
        T = Tables
    >(
        c1: C<T, T1>,
        c2?: C<T, T2>,
        c3?: C<T, T3>,
        c4?: C<T, T4>,
        c5?: C<T, T5>,
        c6?: C<T, T6>,
        c7?: C<T, T7>,
        c8?: C<T, T8>,
        c9?: C<T, T9>,
        c10?: C<T, T10>
    ): UpdateOrderByMethods<Tables>

}

type C<Tables, T extends string> = isTableReferenced<Tables, Key<T>, Expr<T, unknown, SQL_BOOL>>

export interface UpdateOrderByMethods<Tables> extends UpdateLimitMethods {

    orderBy<
        TableRef,
        Columns extends OrderByStructure<Expr<TableRef, string | unknown, any>>
    >(
        ...items: isColumnOkToUse<Tables, Columns>
    ): UpdateLimitMethods

}

export interface UpdateLimitMethods {
    noLimit(): ExecUpdateMethods

    limit(limit: number | [number, number]): ExecUpdateMethods

    limit1(): ExecUpdateMethods
}

export interface ExecUpdateMethods extends SqlQuery<{ affectedRows: number }> {

}
