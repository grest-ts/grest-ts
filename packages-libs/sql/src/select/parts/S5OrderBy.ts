import {AliasedTable, isColumnOkToUse, Key, NotUsingWithPart, OrderByStructure} from "../../Types";
import {LimitMethods} from "./S6Limit";
import {Expr} from "../../SqlExpression";
import {ExecMethods} from "./S7Exec";

export interface OrderByMethods<Result, Tables> extends LimitMethods<Result>, ExecMethods<Result> {
    orderBy<
        TableRef,
        Columns extends OrderByStructure<Expr<TableRef, string | unknown, any>>
    >(
        ...items: isColumnOkToUse<Tables, Columns>
    ): LimitMethods<Result>

    orderByF<
        TableRef,
        Columns extends OrderByStructure<Expr<TableRef, string | unknown, string | number>>
    >(
        func: (columnsTable: AliasedTable<"(columns)", "(columns)", Result, object, NotUsingWithPart>) => isColumnOkToUse<Tables & Key<"(columns)">, Columns>
    ): LimitMethods<Result>

}
