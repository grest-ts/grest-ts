import {AliasedTable, DbTableDefinition, InsertRow, NotUsingWithPart} from "./Types";
import {escape, escapeId} from "./escape";
import {SQL_ALIAS, SQL_EXPRESSION} from "./Symbols";
import {SqlExpression} from "./SqlExpression";
import {DeleteBuilder} from "./delete/DeleteBuilder";
import {ExecInsertMethods} from "./insert/InsertInterfaces";
import {InsertBuilder} from "./insert/InsertBuilder";
import {GatewayDeleteOrderByMethods} from "./delete/DeleteInterfaces";
import {UpdateBuilder} from "./update/UpdateBuilder";
import {GatewayUpdateWhereMethods} from "./update/UpdateInterfaces";
import {SelectBuilder} from "./select/SelectBuilder";
import {GatewayWhereMethods} from "./select/parts/GatewayWhere";


export class MysqlTable<TableName extends string, Entity, EditEntity, InsertEntity = InsertRow<EditEntity, Entity>> {

    public readonly tableName: TableName;
    private readonly columns: DbTableDefinition<Entity>;
    private readonly cache: Map<string, AliasedTable<string, `${TableName} as ${string}`, Entity, InsertEntity, NotUsingWithPart>> = new Map();

    constructor(tableName: TableName, columns: DbTableDefinition<Entity>) {
        this.tableName = tableName;
        this.columns = columns;
        Object.freeze(this.columns);
    }

    public as<Alias extends string>(alias: Alias): AliasedTable<Alias, `${TableName} as ${Alias}`, Entity, InsertEntity, NotUsingWithPart> {
        if (!this.cache.has(alias)) {
            this.cache.set(alias, MysqlTable.defineDbTable<TableName, Alias, Entity, InsertEntity>(escapeId(this.tableName) as TableName, alias, this.columns))
        }
        return this.cache.get(alias) as any
    }

    public select<Args extends & (keyof Entity)[]>(...args: Args & (keyof Entity)[]): GatewayWhereMethods<Entity, ArrayOfPropertiesToObject<Entity, Args>> {
        return new SelectBuilder().selectFrom(this.tableName).columns(...args);
    }

    public selectAll(): GatewayWhereMethods<Entity, Entity> {
        return new SelectBuilder().selectFrom(this.tableName).columns(SqlExpression.create("*"));
    }

    public deleteWhere(where: Partial<Entity>): GatewayDeleteOrderByMethods<Entity> {
        const builder = new DeleteBuilder().from(this.tableName, undefined)
        for (const prop in where) {
            builder.where(escapeId(prop) + " = " + escape((where as any)[prop]));
        }
        return builder
    }

    public insert(row: InsertEntity): ExecInsertMethods {
        return new InsertBuilder().to(this.tableName).set(row)
    }

    public update(row: Partial<InsertEntity>): GatewayUpdateWhereMethods<Entity> {
        return new UpdateBuilder().in(this.tableName).set(row)
    }

    /**
     * Returns query that checks existence of a row. Returns [{res: 1}] if at least one row exists and no rows if it doesn't.
     */
    public exists(args: WhereArgs<Entity>): string {
        const where: string[] = [];
        for (const key in args) {
            where.push(escapeId(key) + "=" + escape(args[key] as any))
        }
        return "SELECT 1 as res FROM " + escapeId(this.tableName) + " WHERE " + where.join(" AND ") + " LIMIT 1";
    }

    public toString(): string {
        return this.tableName;
    }

    /**
     * Define a table structure with alias.
     */
    public static defineDbTable<TableName extends string, Alias extends string, Entity, XEntity>(
        escapedExpression: TableName,
        alias: string,
        columns: DbTableDefinition<Entity>
    ): AliasedTable<Alias, `${TableName} as ${Alias}`, Entity, XEntity, NotUsingWithPart> {
        const tbl: AliasedTable<Alias, `${TableName} as ${Alias}`, Entity, XEntity, NotUsingWithPart> = {
            [SQL_EXPRESSION]: escapedExpression,
            [SQL_ALIAS]: alias
        } as any;
        for (const columnName in columns) {
            (tbl as any)[columnName] = new SqlExpression(escapeId(alias) + "." + escapeId(columnName), columnName)
        }
        Object.freeze(tbl)
        return tbl
    }
}

type WhereArgs<Entity> = {
    [K in keyof Entity]?: Entity[K]
}

type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

type ArrayOfPropertiesToObject<Entity, Args extends (keyof Entity)[]> = UnionToIntersection<{
    [K in keyof Args]: Record<Args[K], Entity[Args[K]]>
}[number]>;