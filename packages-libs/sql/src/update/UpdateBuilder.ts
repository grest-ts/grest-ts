import {escape, escapeId} from "../escape";
import {SQL_ENTITY, SQL_EXPRESSION} from "../Symbols";
import {ExecUpdateMethods, GatewayUpdateOrderByMethods, GatewayUpdateWhereMethods, UpdateLimitMethods, UpdateOrderByMethods, UpdateSetMethods, UpdateWhereMethods} from "./UpdateInterfaces";
import {AnyExpr, SqlExpression} from "../SqlExpression";
import {OrderByStructure} from "../Types";
import {orderByStructureToSqlString, toSql} from "../SqlFunctions";

export class UpdateBuilder<Entity, Tables> implements ExecUpdateMethods,
    GatewayUpdateWhereMethods<Entity>,
    GatewayUpdateOrderByMethods<Entity>,
    UpdateSetMethods<Entity, Tables>,
    UpdateWhereMethods<Tables>,
    UpdateOrderByMethods<Tables>,
    UpdateLimitMethods {

    public readonly [SQL_ENTITY]: { affectedRows: number; }; // never used

    private _tableName: string;
    private _joins: string[] = [];
    private _set: string[] = []
    private readonly _where: string[] = [];
    private readonly _orderBy: string[] = [];
    private _limit: string;
    private _ignore: boolean = false;

    public in(tableName: string, alias?: string) {
        this._tableName = tableName + (alias ? " as " + escapeId(alias) : "");
        return this;
    }

    public ignore() {
        this._ignore = true;
        return this
    }

    public join(table: any): this {
        this._joins.push(table[SQL_EXPRESSION])
        return this;
    }

    public set(obj: any): this {
        for (const prop in obj) {
            this._set.push(escapeId(prop) + " = " + toSql(obj[prop]));
        }
        return this
    }

    public where(...cols: any | SqlExpression<any, any, any>): this {
        for (let i = 0; i < cols.length; i++) {
            const col = cols[i];
            if (col instanceof SqlExpression) {
                this._where.push(col.expression)
            } else {
                for (const k in col) {
                    this._where.push(escapeId(k) + " = " + escape(col[k]))
                }
            }
        }
        return this
    }

    public noWhere() {
        return this;
    }

    public orderBy(...items: any | OrderByStructure<AnyExpr>): this {
        this._orderBy.push(...orderByStructureToSqlString(items))
        return this;
    }

    public noLimit(): this {
        return this;
    }

    public limit1(): this {
        return this.limit(1);
    }

    public limit(limit: number | [number, number]): this {
        if (Array.isArray(limit)) {
            this._limit = Number(limit[0]) + "," + Number(limit[1]);
        } else {
            this._limit = String(Number(limit));
        }
        return this;
    }

    public toSqlString() {
        return "UPDATE " + (this._ignore ? "IGNORE " : "") + this._tableName + " " +
            (this._joins.length > 0 ? ", \n" + this._joins.join(",\n") : "") +
            (this._set.length > 0 ? "SET \n\t" + this._set.join(",\n\t") + " \n" : "") +
            (this._where.length > 0 ? "WHERE " + this._where.join(" AND ") + " \n" : "") +
            (this._orderBy.length > 0 ? "ORDER BY " + this._orderBy.join(", ") + " \n" : "") +
            (this._limit ? "LIMIT " + this._limit : "")
    }
}