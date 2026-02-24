import {OrderByStructure, TAB} from "../Types";
import {escapeId} from "../escape";
import {AnyExpr, SqlExpression} from "../SqlExpression";
import {orderByStructureToSqlString} from "../SqlFunctions";
import {DeleteLimitMethods, DeleteOrderByMethods, DeleteWhereMethods, ExecDeleteMethods, GatewayDeleteOrderByMethods, GatewayDeleteWhereMethods} from "./DeleteInterfaces";
import {SQL_ENTITY} from "../Symbols";

export class DeleteBuilder<Tables, Entity> implements DeleteWhereMethods<Tables>,
    DeleteOrderByMethods<Tables>,
    DeleteLimitMethods,
    ExecDeleteMethods,
    GatewayDeleteWhereMethods<Entity>,
    GatewayDeleteOrderByMethods<Entity> {

    public readonly [SQL_ENTITY]: undefined; // never used

    private _from: string;
    private readonly _where: string[] = [];
    private readonly _orderBy: string[] = [];
    private _limit: string;

    public from(table: string, alias: string): this {
        this._from = table + (alias ? " as " + escapeId(alias) : "");
        return this;
    }

    public where(...cols: any | SqlExpression<any, any, any>): this {
        for (let i = 0; i < cols.length; i++) {
            if (cols[i]) {
                this._where.push(cols[i].expression)
            }
        }
        return this
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

    public toSqlString(lvl: number = 0): string {
        const tabs = TAB.repeat(lvl);
        return "DELETE FROM " + this._from + "\n" +
            (this._where.length === 0 ? tabs + "WHERE " + this._where.join(" AND ") + "\n" : "WHERE 1=2") +
            (this._orderBy.length > 0 ? tabs + "ORDER BY " + this._orderBy.join(", ") + "\n" : "") +
            (this._limit ? tabs + "LIMIT " + this._limit + "\n" : "")
    }
}