import {AliasedTable, isColumnOkToUse, Key, NotUsingWithPart} from "../../Types";
import {HavingMethods} from "./S4Having";
import {Expr} from "../../SqlExpression";
import {OrderByMethods} from "./S5OrderBy";
import {LimitMethods} from "./S6Limit";

export interface GroupByMethods<Result, Tables> extends OrderByMethods<Result, Tables>, LimitMethods<Result> {
    groupBy<
        TableRef,
        Columns extends Expr<TableRef, string | unknown, any>[]
    >(
        ...items: isColumnOkToUse<Tables, Columns>
    ): HavingMethods<Result, Tables>

    groupByF<
        TableRef,
        Columns extends Expr<TableRef, string | unknown, any>[]
    >(
        func: (columnsTable: AliasedTable<"(columns)", "(columns)", Result, object, NotUsingWithPart>) => isColumnOkToUse<Tables & Key<"(columns)">, Columns>
    ): HavingMethods<Result, Tables>
}


