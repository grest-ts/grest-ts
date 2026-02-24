import {AliasedTable, IsAMatchingB, NotUsingWithPart, SqlQuery} from "../Types";

export interface ExecInsertMethods extends SqlQuery<{ insertId: number }> {

}

export interface InsertSetMethods<Entity> {

    set(value: Entity): ExecInsertMethods

    values(value: Entity[]): ExecInsertMethods

    select<Result>(value: IsAMatchingB<Result, Entity, AliasedTable<string, string, Result, object, NotUsingWithPart>>): ExecInsertMethods
}


