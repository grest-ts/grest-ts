import {Over, SqlExpression, Transformer} from "../SqlExpression";
import {WhereMethods} from "./parts/S2Where";
import {ColumnsMethods} from "./parts/S2Columns";
import {JoinMethods} from "./parts/S1Join";
import {WithMethods} from "./parts/S0With";
import {UsesMethods} from "./parts/S0Uses";
import {UnionMethods} from "./parts/S0Union";
import {GroupByMethods} from "./parts/S3GroupBy";
import {HavingMethods} from "./parts/S4Having";
import {OrderByMethods} from "./parts/S5OrderBy";
import {LimitMethods} from "./parts/S6Limit";
import {ExecMethods} from "./parts/S7Exec";
import {MysqlTable} from "../MysqlTable";
import {SQL_ALIAS, SQL_ENTITY, SQL_EXPRESSION} from "../Symbols";
import {AliasedTable, AnyAliasedTableDef, DbTableDefinition, SelectExecutor} from "../Types";
import {escape, escapeId} from "../escape";
import {ONE, orderByStructureToSqlString} from "../SqlFunctions";
import {GatewaySelectGroupByMethods, GatewaySelectLimitMethods, GatewaySelectOrderByMethods, GatewayWhereMethods} from "./parts/GatewayWhere";

const TAB = "  ";

export class SelectBuilder<Result, Aliases, AliasesFromWith, Tables> implements UnionMethods<Result>,
    WithMethods<AliasesFromWith>,
    UsesMethods<Aliases, Tables>,
    JoinMethods<Aliases, AliasesFromWith, Tables>,
    ColumnsMethods<Result, Tables>,
    WhereMethods<Result, Tables>,
    GroupByMethods<Result, Tables>,
    HavingMethods<Result, Tables>,
    OrderByMethods<Result, Tables>,
    LimitMethods<Result>,
    ExecMethods<Result>,
    GatewayWhereMethods<Result, Tables>,
    GatewaySelectGroupByMethods<Result, Tables>,
    GatewaySelectOrderByMethods<Result, Tables>,
    GatewaySelectOrderByMethods<Result, Tables>,
    GatewaySelectLimitMethods<Result> {

    public readonly [SQL_ENTITY]: undefined; // never used

    private _withQueries: Map<string, string> = new Map()
    private _from: string;
    private readonly _columns: string[] = [];
    private _columnStruct: DbTableDefinition<any> = {} as any;

    private readonly _joins: string[] = []
    private readonly _windows: string[] = []
    private readonly _where: string[] = []
    private readonly _having: string[] = []
    private readonly _groupBy: string[] = []
    private _orderBy: string[] = []
    private _limit: string = undefined

    private readonly unions: string[] = []
    private _unionColumnOrder: string[] = []

    private _distinct: boolean = false;
    private _forUpdate: boolean = false;

    public readonly transformers: { property: string, transformer: Transformer<any, any> }[] = []

    public union(table: any | SelectBuilder<any, any, any, any>): SelectBuilder<any, any, any, any> {
        return this._union(table, "DISTINCT") as any
    }

    public unionAll(table: any | SelectBuilder<any, any, any, any>): SelectBuilder<any, any, any, any> {
        return this._union(table, "ALL")
    }

    private _union(table: SelectBuilder<any, any, any, any>, type: "ALL" | "DISTINCT" = "DISTINCT"): SelectBuilder<any, any, any, any> {
        if (this.unions.length === 0) {
            const builder = new SelectBuilder()
            builder.unions.push("(\n" + this.toString(1) + ") ")
            builder._columnStruct = this._columnStruct;
            for (const k in this._columnStruct) {
                builder._unionColumnOrder.push(k);
            }
            builder._union(table, type);
            return builder;
        } else {
            const struct = table._columnStruct;
            let i = 0;
            for (const k in struct) {
                if (this._unionColumnOrder[i] !== k) {
                    const order: string[] = []
                    for (const k in struct) {
                        order.push(k);
                    }
                    throw new Error("Union columns from pos " + i + " do not match! \nFirst call columns:   '" + this._unionColumnOrder.join(", ") + "'. \nCurrent call columns: '" + order.join(", ") + "'")
                }
                i++;
            }
            if (i !== this._unionColumnOrder.length) {
                throw new Error("Union columns count do not match! " + this._unionColumnOrder.length + " != " + i + " (Why didn't compiler warn you about this?)");
            }
            this.unions.push("UNION " + (type === "DISTINCT" ? "DISTINCT " : "ALL ") + "(\n" + table.toString(1) + ") ")
            return this;
        }
    }

    public with(...tables: (any | AnyAliasedTableDef)[]) {
        console.log(tables)
        for (let i = 0; i < tables.length; i++) {
            const table = tables[i];
            const alias = table[SQL_ALIAS]
            this._withQueries.set(alias, escapeId(alias) + " AS " + table[SQL_EXPRESSION])
        }
        return this
    }

    public uses(table: any | AnyAliasedTableDef) {
        return this
    }

    public selectFrom(table: any | AnyAliasedTableDef) {
        if (typeof table === "string") {
            this._from = escapeId(table);
        } else {
            this._from = table[SQL_EXPRESSION] + " as " + escapeId(table[SQL_ALIAS]);
        }

        return this
    }

    public join(table: any | AnyAliasedTableDef, condition: any) {
        return this._join(table, condition, "JOIN")
    }

    public leftJoin(table: any | AnyAliasedTableDef, condition: any) {
        return this._join(table, condition, "LEFT JOIN")
    }

    private _join(table: AnyAliasedTableDef, condition: any, type: "JOIN" | "LEFT JOIN" = "JOIN") {
        const sql = this._withQueries.has(table[SQL_ALIAS]) ? escapeId(table[SQL_ALIAS]) : table[SQL_EXPRESSION] + " as " + escapeId(table[SQL_ALIAS])
        this._joins.push(type + " " + sql + " ON (" + condition.expression + ")")
        return this;
    }

    public window(name: string, func: (builder: Over<any>) => Over<any>) {
        const builder2 = new Over()
        func(builder2)
        this._windows.push(name + " AS (" + builder2.toString() + ")")
        return this
    }

    public distinct() {
        this._distinct = true;
        return this
    }

    public columns(...cols: (any | string | SqlExpression<string, string, any>)[]) {
        for (let i = 0; i < cols.length; i++) {
            const col = cols[i];
            if (col instanceof SqlExpression) {
                this._columns.push(col.expression + (col.nameAs ? " as " + escapeId(col.nameAs) : ""));
                (this._columnStruct as any)[col.nameAs] = true;
                if (col.transformer) {
                    this.transformers.push({property: col.nameAs, transformer: col.transformer});
                }
            } else if (typeof col === "string") {
                this._columns.push(escapeId(col));
                (this._columnStruct as any)[col] = true;
            }
        }
        return this
    }

    public one() {
        this.columns(ONE())
        return this;
    }

    public allColumnsFrom(table: any | AnyAliasedTableDef) {
        for (const k in table) {
            this.columns(table[k])
        }
        return this
    }

    public noWhere() {
        return this as any
    }

    public where(...cols: (any | undefined | null | "" | object | SqlExpression<string, string, any>)[]) {
        for (let i = 0; i < cols.length; i++) {
            const col = cols[i];
            if (col instanceof SqlExpression) {
                this._where.push(col.expression);
            } else if (typeof col === "object") {
                for (const prop in col) {
                    this._where.push(escapeId(prop) + " = " + escape(col[prop]));
                }
            } else if (col === undefined || col === null || col === "" || col === false) {
                // skip
            } else {
                throw new Error("Invalid argument to where! Type: '" + (typeof col) + "' String: '" + String(col) + "'")
            }
        }
        return this as any
    }

    public groupBy(...items: (any | SqlExpression<string, string, any>)[]) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item instanceof SqlExpression) {
                this._groupBy.push(item.expression);
            } else if (typeof item === "string") {
                this._groupBy.push(escapeId(item));
            } else if (item === undefined || item === null || item === "") {
                // skip
            } else {
                throw new Error("Invalid argument to groupBy! Type: '" + (typeof item) + "' String: '" + String(item) + "'")
            }
        }
        return this as any
    }

    public groupByF(func: (res: any | AliasedTable<string, string, Result, unknown, any>) => (any | SqlExpression<string, string, any>)[]) {
        const proxy: any = new Proxy({}, {
            get(target: {}, p: string, receiver: any): any {
                if (p === "" || p === "undefined") {
                    return undefined;
                }
                return new SqlExpression(p, p)
            }
        })
        this.groupBy(...(func(proxy) as any));
        return this as any
    }

    public having(...items: (any | SqlExpression<string, string, any>)[]) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item instanceof SqlExpression) {
                this._having.push(item.expression);
            } else if (typeof item === "string") {
                this._having.push(escapeId(item));
            } else if (item === undefined || item === null || item === "") {
                // skip
            } else {
                throw new Error("Invalid argument to having! Type: '" + (typeof item) + "' String: '" + String(item) + "'")
            }
        }
        return this as any
    }

    public havingF(func: (res: any | AliasedTable<string, string, Result, unknown, any>) => (any | SqlExpression<string, string, any>)[]) {
        const proxy: any = new Proxy({}, {
            get(target: {}, p: string, receiver: any): any {
                if (p === "" || p === "undefined") {
                    return undefined;
                }
                return new SqlExpression(p, p)
            }
        })
        this.having(...(func(proxy) as any));
        return this
    }

    public orderBy(...items: (any | SqlExpression<string, string, any>)[]) {
        this._orderBy = orderByStructureToSqlString(items as any)
        return this as any
    }

    public orderByF(func: (res: any | AliasedTable<string, string, Result, unknown, any>) => (any | SqlExpression<string, string, any>)[]) {
        const proxy: any = new Proxy({}, {
            get(target: {}, p: string, receiver: any): any {
                if (p === "" || p === "undefined") {
                    return undefined;
                }
                return new SqlExpression(p, p)
            }
        })
        this.orderBy(...(func(proxy) as any));
        return this
    }

    public noLimit() {
        return this as any
    }

    public limit(limit: number | [number, number]) {
        if (Array.isArray(limit)) {
            this._limit = Number(limit[0]) + "," + Number(limit[1]);
        } else if (limit !== undefined && limit !== null && String(limit) !== "") {
            this._limit = String(Number(limit));
        }
        return this as any
    }

    public limit1() {
        return this.limit(1) as any
    }

    public forUpdate() {
        this._forUpdate = true;
        return this as any
    }

    public asScalar(alias: any): any {
        return SqlExpression.create("(\n" + this.toString(2) + TAB + ")", alias);
    }

    public as(alias: any): any {
        return MysqlTable.defineDbTable("(\n" + this.toString(2) + ")" as "(SUBQUERY)", alias, this._columnStruct)
    }

    public async transformResult<T>(rows: T[]): Promise<T[]> {
        for (let r = 0; r < rows.length; r++) {
            const row: any = rows[r];
            for (let i = 0; i < this.transformers.length; i++) {
                const parser = this.transformers[i]
                const res = parser.transformer(row[parser.property]);
                if (res instanceof Promise) {
                    row[parser.property] = await res;
                } else {
                    row[parser.property] = res;
                }
            }
        }
        return rows;
    }

    public toString(lvl: number = 0) {
        if (this.transformers.length > 0) {
            throw new Error("Select.toString() call might be accidental! This query uses transforms and it may cause errors in the application! " +
                "This is safety measure to avoid executing queries that have transforms that would not get executed! " +
                "You can call toSqlQuery() method to still get a sql string!")
        }
        return this._toString(lvl);
    }

    public toSqlString() {
        return this._toString();
    }

    private _toString(lvl: number = 0) {
        const tabs = TAB.repeat(lvl);
        let base: string;
        if (this.unions.length > 0) {
            base = this.unions.join("") + "\n";
        } else {
            base = (this._withQueries.size > 0 ? tabs + "WITH\n" + TAB + Array.from(this._withQueries.values()).join(",\n\n" + TAB) + "\n\n" : "") +
                tabs + "SELECT " + (this._distinct ? "DISTINCT " : "") + "\n" +
                tabs + TAB + this._columns.join(",\n" + tabs + TAB) + "\n" +
                tabs + "FROM " + this._from + "\n" +
                (this._joins.length > 0 ? tabs + this._joins.join("\n") + "\n" : "") +
                (this._where.length > 0 ? tabs + "WHERE " + this._where.join("\n" + TAB + " AND ") + "\n" : "")
        }

        return base +
            (this._groupBy.length > 0 ? tabs + "GROUP BY " + this._groupBy.join(", ") + "\n" : "") +
            (this._having.length > 0 ? tabs + "HAVING " + this._having.join("\n" + TAB + " AND ") + "\n" : "") +
            (this._windows.length > 0 ? tabs + "WINDOW " + this._windows.join(",\n" + TAB) + "\n" : "") +
            (this._orderBy.length > 0 ? tabs + "ORDER BY " + this._orderBy.join(", ") + "\n" : "") +
            (this._limit ? tabs + "LIMIT " + this._limit + "\n" : "") +
            (this._forUpdate && this.unions.length === 0 ? tabs + "FOR UPDATE\n" : "");
    }

    public async exec<Args extends any[]>(executor: SelectExecutor<Result, Args>, ...args: Args): Promise<Result[]> {
        const res = await executor(this.toSqlString(), ...args);
        if (res && res.length > 0 && this.transformers.length > 0) {
            await this.transformResult(res)
        }
        return res;
    }

    public async execOne<Args extends any[]>(executor: SelectExecutor<Result, Args>, ...args: Args): Promise<Result> {
        return (await this.exec(executor, ...args))?.[0]
    }

}