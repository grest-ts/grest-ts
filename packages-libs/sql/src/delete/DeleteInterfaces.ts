import {isColumnOkToUse, isTableReferenced, Key, OrderByStructure, SQL_BOOL, SqlQuery} from "../Types";
import {Expr} from "../SqlExpression";

export interface GatewayDeleteWhereMethods<Entity> {

    where(c1: Partial<Entity>): GatewayDeleteOrderByMethods<Entity>
}

export interface GatewayDeleteOrderByMethods<Entity> extends DeleteLimitMethods {

    orderBy(fields: keyof Entity): DeleteLimitMethods

}

export interface DeleteWhereMethods<Tables> {

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
    ): DeleteOrderByMethods<Tables> & DeleteLimitMethods

}

type C<Tables, T extends string> = isTableReferenced<Tables, Key<T>, Expr<T, unknown, SQL_BOOL>>

export interface DeleteOrderByMethods<Tables> extends DeleteLimitMethods {
    orderBy<
        TableRef,
        Columns extends OrderByStructure<Expr<TableRef, string | unknown, any>>
    >(
        ...items: isColumnOkToUse<Tables, Columns>
    ): DeleteLimitMethods
}


export interface DeleteLimitMethods {
    noLimit(): ExecDeleteMethods

    limit(limit: number | [number, number]): ExecDeleteMethods

    limit1(): ExecDeleteMethods
}


export interface ExecDeleteMethods extends SqlQuery<{ affectedRows: number }> {

    toString(lvl?: number): string

}

