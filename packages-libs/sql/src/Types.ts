import {Expr} from "./SqlExpression";
import {SQL_ALIAS, SQL_ALIAS_FOR_WITH_QUERY, SQL_EDIT_ENTITY, SQL_ENTITY, SQL_EXPRESSION} from "./Symbols";
import {ColumnDataType} from "./MysqlTableStructureParser";

export type Key<Alias extends string> = Record<Alias, true>;

export type SqlQuery<Result> = {

    [SQL_ENTITY]: Result; // This is needed for typescript typing. It is never populated

    toSqlString(): string

}

export type SqlSelectQuery<Result> = SqlQuery<Result> & {

    transformResult<T>(row: T[]): Promise<T[]>;
}

export type SelectExecutor<Result, Args extends any[] = never, Arg1 extends any = never> = (sql: string, ...args: Args) => Promise<Result[]>

const TAB = "  ";
const DISTINCT = "DISTINCT";
export {DISTINCT, TAB}

// -----------------------------------------------------

export type AliasedTable<Alias extends string, TableRef, Entity, EditEntity, AliasForWithQuery extends string | NotUsingWithPart> = {
    [SQL_ALIAS]: Alias
    [SQL_EXPRESSION]: TableRef
    [SQL_ALIAS_FOR_WITH_QUERY]: AliasForWithQuery
    [SQL_ENTITY]: Entity
    [SQL_EDIT_ENTITY]: EditEntity
} & {
    [K in keyof Entity]: Expr<TableRef, K, Entity[K]>
}

export type AnyAliasedTableDef = AliasedTable<string, string, {}, {}, string | NotUsingWithPart>

export type DbTableDefinition<T> = {
    [P in keyof T]: { type: ColumnDataType, len?: number, default?: any, isAutoIncrement?: true, isPrimary?: true }
};

export type InsertRow<InsertRow, FullRow> = {
    [P in keyof InsertRow]: P extends keyof FullRow ? FullRow[P] : never;
};

export type UpdateRow<InsertRow, FullRow> = {
    [P in keyof InsertRow]?: P extends keyof FullRow ? FullRow[P] : never;
};

// ----------------------------------------------

export type NotUsingWithPart = { __not_referenced: true }

export type PrepareQueryArgument = { __prepare_argument: true, expression: string }

export function isPrepareArgument(arg: unknown): arg is PrepareQueryArgument {
    return (arg as any)?.__prepare_argument === true;
}

// ----------------------------------------------

export type SQL_BOOL = 0 | 1;

export type COMPARISON_SIGNS = "!=" | "<>" | "=" | ">=" | ">" | "<" | "<=" | "LIKE" | "NOT LIKE"

const ComparisonOperandsLookup: Set<COMPARISON_SIGNS> = new Set(["!=", "=", ">=", ">", "<", "<=", "LIKE", "NOT LIKE"] as const)

export {ComparisonOperandsLookup}

export type DATE_ADD_UNITS = "MICROSECOND"
    | 'SECOND'
    | 'MINUTE'
    | 'HOUR'
    | 'DAY'
    | 'WEEK'
    | 'MONTH'
    | 'QUARTER'
    | 'YEAR'
    | 'SECOND_MICROSECOND'
    | 'MINUTE_MICROSECOND'
    | 'MINUTE_SECOND'
    | 'HOUR_MICROSECOND'
    | 'HOUR_SECOND'
    | 'HOUR_MINUTE'
    | 'DAY_MICROSECOND'
    | 'DAY_SECOND'
    | 'DAY_MINUTE'
    | 'DAY_HOUR'
    | 'YEAR_MONTH';

const DateAddUnitsLookup: Set<DATE_ADD_UNITS> = new Set([
    "MICROSECOND",
    'SECOND',
    'MINUTE',
    'HOUR',
    'DAY',
    'WEEK',
    'MONTH',
    'QUARTER',
    'YEAR',
    'SECOND_MICROSECOND',
    'MINUTE_MICROSECOND',
    'MINUTE_SECOND',
    'HOUR_MICROSECOND',
    'HOUR_SECOND',
    'HOUR_MINUTE',
    'DAY_MICROSECOND',
    'DAY_SECOND',
    'DAY_MINUTE',
    'DAY_HOUR',
    'YEAR_MONTH'
] as const);

export {DateAddUnitsLookup}

// ----------------------------------------------

/**
 * Check if Alias ("c") already exists in UsedAliases=(R<"c"> & ...)
 */
export type isAliasAlreadyUsed<Aliases, Alias extends string, OUT> = Alias extends keyof Aliases ? `Alias '${Alias}' is already used!` : OUT

// ----------------------------------------------
// This stuff helps to check if 'Table as Alias' exists in usedTables

type _extractMissingAlias<Tables, CheckTables> = { [K in keyof CheckTables]: K extends keyof Tables ? never : K }[keyof CheckTables];
/**
 * Check if UsedTablesToMatch=(R<Alias.Table> & ...) exists in UsedTables=(R<Alias.Table> & ...)
 */
// type _AllKeys<T> = T extends any ? keyof T : never;
// export type isTableReferenced<Tables, CheckTables, OUT> = _AllKeys<CheckTables> extends _AllKeys<Tables> might be more correct if unions would be used, but we don't really use them in this place.
export type isTableReferenced<Tables, CheckTables, OUT> = keyof CheckTables extends keyof Tables
    ? OUT
    : `Table '${_extractMissingAlias<Tables, CheckTables> extends `${infer TableRef}` ? `${TableRef}` : "???"}' is not used in this query!`

// ----------------------------------------------

/**
 * Anyone finds a better way, please write it. Rules are as follows:
 * 1) A is always first
 * 2) B can only appear after A
 *
 To generate this stuff :)
 function gen(len) {
 if (len <= 0) return [];
 const results = new Set(["A"]);
 function generateCombinations(currentLen, currentStr) {
 if (currentLen >= len) return;
 const nextA = currentStr + ',A';
 generateCombinations(currentLen + 1, nextA);
 results.add(nextA);
 if (currentStr[currentStr.length - 1] !== 'B') {
 const nextB = currentStr + ',B';
 generateCombinations(currentLen, nextB);
 results.add(nextB);
 }
 }
 generateCombinations(1, 'A');
 return "[" + Array.from(results.values()).sort().join("]\n | [") + "]";
 }
 console.log(gen(5)); // Example usage
 */
export type ORDER_BY = "asc" | "desc" | "ASC" | "DESC"

export type OrderByStructure<A, B = ORDER_BY> =
    [A]
    | [A, A]
    | [A, A, A]
    | [A, A, A, A]
    | [A, A, A, A, A]
    | [A, A, A, A, B]
    | [A, A, A, A, B, A]
    | [A, A, A, B]
    | [A, A, A, B, A]
    | [A, A, A, B, A, A]
    | [A, A, A, B, A, B]
    | [A, A, A, B, A, B, A]
    | [A, A, B]
    | [A, A, B, A]
    | [A, A, B, A, A]
    | [A, A, B, A, A, A]
    | [A, A, B, A, A, B]
    | [A, A, B, A, A, B, A]
    | [A, A, B, A, B]
    | [A, A, B, A, B, A]
    | [A, A, B, A, B, A, A]
    | [A, A, B, A, B, A, B]
    | [A, A, B, A, B, A, B, A]
    | [A, B]
    | [A, B, A]
    | [A, B, A, A]
    | [A, B, A, A, A]
    | [A, B, A, A, A, A]
    | [A, B, A, A, A, B]
    | [A, B, A, A, A, B, A]
    | [A, B, A, A, B]
    | [A, B, A, A, B, A]
    | [A, B, A, A, B, A, A]
    | [A, B, A, A, B, A, B]
    | [A, B, A, A, B, A, B, A]
    | [A, B, A, B]
    | [A, B, A, B, A]
    | [A, B, A, B, A, A]
    | [A, B, A, B, A, A, A]
    | [A, B, A, B, A, A, B]
    | [A, B, A, B, A, A, B, A]
    | [A, B, A, B, A, B]
    | [A, B, A, B, A, B, A]
    | [A, B, A, B, A, B, A, A]
    | [A, B, A, B, A, B, A, B]
    | [A, B, A, B, A, B, A, B, A]

// ----------------------------------------------

export type isColumnOkToUse<Tables, ColumnExpressions> =
    ColumnExpressions extends []
        ? ColumnExpressions
        : ColumnExpressions extends [infer A, ...(infer Rest)]
            ? [_checkThatTableOrColumnCanBeReferenced<Tables, A>, ...isColumnOkToUse<Tables, Rest>]
            : ColumnExpressions;

type _checkThatTableOrColumnCanBeReferenced<Tables, Expr> =
    Expr extends { tableRef: string } ?
        Expr["tableRef"] extends keyof Tables ?
            Expr
            : `Table '${_getMissing<Tables, Expr["tableRef"]>}' is not used in this query!`
        : Expr

type _getMissing<Tables, Check> = Check extends keyof Tables ? never : Check;

// ----------------------------------------------

export type IsAMatchingB<Result, Entity, OUT> = _findDifferentPropertyNames<Result, Entity> extends never ? OUT : _findDifferentPropertyNames<Result, Entity>;

type _valuesToUnion<T> = T[keyof T];

type _findDifferentPropertyNames<Result, Entity> =
    _valuesToUnion<{ [K in Exclude<keyof Entity, keyof Result>]: `Property '${K extends string ? K : ""}' is missing!` }>
    | _valuesToUnion<{ [K in Exclude<keyof Result, keyof Entity>]: `Property '${K extends string ? K : ""}' should not be listed!` }>
    | _valuesToUnion<{ [K in keyof Result & keyof Entity]: Result[K] extends Entity[K] ? never : `Property '${K extends string ? K : ""}' type does not match!` }>;

// ----------------------------------------------
