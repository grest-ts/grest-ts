import {escape, escapeId} from "../escape";
import {ExecInsertMethods, InsertSetMethods} from "./InsertInterfaces";
import {SQL_ENTITY, SQL_EXPRESSION} from "../Symbols";

export class InsertBuilder<Entity> implements ExecInsertMethods, InsertSetMethods<Entity> {

    public readonly [SQL_ENTITY]: undefined; // never used

    private _ignore: boolean = false;
    private _tableName: string;

    private _set: string[] = []

    private _valueNames: Set<string>;
    private _valuesObjects: any[];

    private _select: string;


    public to(tableName: string) {
        this._tableName = tableName;
        return this;
    }

    public ignore() {
        this._ignore = true;
        return this;
    }

    public select(query: any) {
        this._select = query[SQL_EXPRESSION];
        return this;
    }

    public set(obj: any) {
        for (const prop in obj) {
            this._set.push(escapeId(prop) + " = " + escape(obj[prop]));
        }
        return this;
    }

    public values(objects: any[]) {
        this._valueNames = new Set();
        for (let i = 0; i < objects.length; i++) {
            for (const prop in objects[i]) {
                this._valueNames.add(prop);
            }
        }
        this._valuesObjects = objects;
        return this;
    }

    private toValuesString() {
        const valueNames = Array.from(this._valueNames.values());
        const fields = "(" + valueNames.map(e => escapeId(e)).join(", ") + ") VALUES \n";
        const cols: string[] = [];
        for (let i = 0; i < this._valuesObjects.length; i++) {
            const obj = this._valuesObjects[i];
            const col: string[] = [];
            for (let v = 0; v < valueNames.length; v++) {
                const value = obj[valueNames[v]];
                col.push(value === undefined ? "NULL" : escape(value))
            }
            cols.push("(" + col.join(", ") + ")");
            col.length = 0;
        }
        return fields + cols.join(",\n");
    }

    public toSqlString() {
        return "INSERT " + (this._ignore ? "IGNORE " : "") + "INTO " + this._tableName + " " +
            (this._set.length > 0 ? "SET \n " + this._set.join(",\n") + "\n" : "") +
            (this._valueNames?.size > 0 ? "" + this.toValuesString() : "") +
            (this._select ? this._select : "")
    }
}