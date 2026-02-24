import {COMPARISON_SIGNS, OrderByStructure, PrepareQueryArgument, SQL_BOOL} from "./Types";
import {COMPARE, CONTAINS, ENDS_WITH, IN, IS_NULL, LIKE, NOT_NULL, orderByStructureToSqlString, STARTS_WITH} from "./SqlFunctions";
import {escapeId} from "./escape";

export type Expr<TableRef, Name, Type extends string | number | unknown> =
    symbol &
    { tableRef: TableRef, type: Type } &
    SqlExpression<TableRef, Name, Type>

export type AnyBoolExpr<TableRef> = Expr<TableRef, string | unknown, SQL_BOOL>;

export type AnyExpr = Expr<string, string | unknown, string | number | unknown>

export type Transformer<Input, Output> = ((value: Input) => Output) | ((value: Input) => Promise<Output>)

export class SqlExpression<TableRef, Name extends string | unknown | undefined, Type extends string | number | unknown> {

    public readonly expression: string;
    public readonly nameAs: Name | undefined;
    public readonly transformer: Transformer<unknown, Type>

    constructor(expression: string, nameAs?: Name, parser?: Transformer<unknown, Type>) {
        this.expression = expression;
        this.nameAs = nameAs;
        this.transformer = parser;
        Object.freeze(this);
    }

    private asExpr(): Expr<TableRef, string | unknown, any> {
        return this as any;
    }

    public static create<TableRef, Name, Type>(expression: string, nameAs?: string | unknown | undefined, parser?: Transformer<unknown, Type>): Expr<TableRef, Name, Type> {
        return new SqlExpression(expression, nameAs, parser) as any
    }

    public cast<CastType extends string | number>(): Expr<TableRef, Name, CastType> {
        return this as any;
    }

    public as<NewName extends string>(name: NewName): Expr<TableRef, NewName, Type> {
        return new SqlExpression<TableRef, NewName, Type>(this.expression, name, this.transformer) as any;
    }

    public transform<ResultType>(func: (value: Type) => ResultType): Expr<TableRef, Name, ResultType> {
        return new SqlExpression<TableRef, Name, ResultType>(this.expression, this.nameAs, func) as any
    }

    public asyncTransform<ResultType>(func: (value: Type) => Promise<ResultType>): Expr<TableRef, Name, ResultType> {
        return new SqlExpression<TableRef, Name, ResultType>(this.expression, this.nameAs, func) as any
    }

    // -------------------------------------------------------------------
    // BOOLEAN CHECKS
    // -------------------------------------------------------------------

    public isNull(): Expr<TableRef, unknown, SQL_BOOL> {
        return IS_NULL(this.asExpr());
    }

    public isNotNull(): Expr<TableRef, unknown, SQL_BOOL> {
        return NOT_NULL(this.asExpr());
    }


    public notNull(): Expr<TableRef, unknown, SQL_BOOL> {
        return NOT_NULL(this.asExpr());
    }

    public in<TableRef2 = never>(values: Type[] | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return IN(this.asExpr(), values);
    }

    public notEq<TableRef2 = never>(col2: Type | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return COMPARE(this.asExpr(), "!=", col2);
    }

    public eq<TableRef2 = never>(col2: Type | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return COMPARE(this.asExpr(), "=", col2);
    }

    public lt<TableRef2 = never>(col2: Type | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return COMPARE(this.asExpr(), "<", col2);
    }

    public gt<TableRef2 = never>(col2: Type | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return COMPARE(this.asExpr(), ">", col2);
    }

    public lte<TableRef2 = never>(col2: Type | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return COMPARE(this.asExpr(), "<=", col2);
    }

    public gte<TableRef2 = never>(col2: Type | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return COMPARE(this.asExpr(), ">=", col2);
    }

    public compare<TableRef2 = never>(op: COMPARISON_SIGNS, value: Type | Expr<TableRef2, string | unknown, Type> | PrepareQueryArgument): Expr<TableRef | TableRef2, unknown, SQL_BOOL> {
        return COMPARE(this.asExpr(), op, value)
    }

    public like(value: string): Expr<TableRef, unknown, SQL_BOOL> {
        return LIKE(this.asExpr(), value);
    }

    public contains(value: string): Expr<TableRef, unknown, SQL_BOOL> {
        return CONTAINS(this.asExpr(), value);
    }

    public startsWith(value: string): Expr<TableRef, unknown, SQL_BOOL> {
        return STARTS_WITH(this.asExpr(), value);
    }

    public endsWith(value: string): Expr<TableRef, unknown, SQL_BOOL> {
        return ENDS_WITH(this.asExpr(), value);
    }

}

export type ExprWithOver<TableRef, Name, Type extends string | number | unknown> =
    symbol
    & Expr<TableRef, Name, Type>
    & SqlExpressionWithOver<TableRef, Name, Type>

export class SqlExpressionWithOver<TableRef, Name, Type extends string | number | unknown> extends SqlExpression<TableRef, Name, Type> {

    public static create<TableRef, Name, Type>(expression: string, nameAs?: string | unknown | undefined): ExprWithOver<TableRef, Name, Type> {
        return new SqlExpressionWithOver(expression, nameAs) as any
    }

    public over<TableRef1 extends string>(func: (builder: Over<never>) => Over<TableRef1>): Expr<TableRef | TableRef1, unknown, Type>
    //public over<WindowName extends string>(namedWindow: WindowName): Expr<TableRef | `${WINDOW} as ${WindowName}`, unknown, Type>
    public over<WindowName extends string, TableRef1>(namedWindow: WindowName, func: (builder: Over<TableRef1>) => void): Expr<TableRef | TableRef1 | `(window) as ${WindowName}`, unknown, Type>
    public over(a: any, b?: any): any {
        let namedWindow: string = undefined;
        let func: (builder: Over<never>) => void = undefined;
        if (typeof a === "function") {
            func = a
        } else if (typeof a === "string") {
            namedWindow = a;
            if (typeof b === "function") {
                func = b
            }
        }
        const builder = new Over<{}>();
        func(builder);
        return SqlExpression.create(this.expression + " OVER (" + (namedWindow ? escapeId(namedWindow) + " " : "") + builder.toString() + ")");
    }

}

export class Over<TableRef> {

    private _partitionBy: string[];
    private _orderBy: string[];

    public orderBy<TableRef2>(...cols: OrderByStructure<Expr<TableRef2, string, any>>): Over<TableRef | TableRef2> {
        this._orderBy = orderByStructureToSqlString(cols)
        return this as any;
    }

    public partitionBy<TableRef2>(...cols: Expr<TableRef2, string, any>[]): Over<TableRef | TableRef2> {
        this._partitionBy = cols.map(e => e.expression)
        return this as any;
    }

    public toString() {
        return (this._partitionBy?.length > 0 ? " PARTITION BY " + this._partitionBy.join(", ") : "") +
            (this._orderBy?.length > 0 ? " ORDER BY " + this._orderBy.join(", ") : "")
    }

}
