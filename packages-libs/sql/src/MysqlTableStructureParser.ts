import {escape} from "./escape";

export class MysqlTableStructureParser {

    public static getSchemaRowsQuery(database: string): string {
        return "SELECT " +
            "   table_schema as tableSchema, \n" +
            "   table_name as tableName, \n" +
            "   is_nullable as isNullable, \n" +
            "   column_default as columnDefault, \n" +
            "   column_name as columnName, \n" +
            "   collation_name as collationName, \n" +
            "   column_type as columnType, \n" +
            "   column_key as columnKey, \n" +
            "   ordinal_position as ordinalPosition, \n" +
            "   character_octet_length as characterOctetLength, \n" +
            "   numeric_precision as numericPrecision, \n" +
            "   numeric_scale as numericScale, \n" +
            "   data_type as dataType, \n" +
            "   character_maximum_length as characterMaximumLength, \n" +
            "   datetime_precision as datetimePrecision, \n" +
            "   character_set_name as characterSetName, \n" +
            "   extra as extra, \n" +
            "   column_comment as columnComment \n" +
            "FROM INFORMATION_SCHEMA.columns \n" +
            "WHERE table_schema LIKE " + escape(database) + " " +
            "ORDER BY table_schema, table_name, ordinal_position ";
    }

    public static parse(schema: SchemaRow[]): TableStructure[] {
        const tables: Map<string, TableStructure> = new Map()
        for (const row of schema) {
            if (!tables.has(row.tableName)) {
                tables.set(row.tableName, {name: row.tableName, columns: []})
            }
            tables.get(row.tableName).columns.push(this.parseColumn(row));
        }
        return Array.from(tables.values()).sort((a, b) => a.name >= b.name ? 1 : -1);
    }

    private static parseColumn(row: SchemaRow): AnyColumn {
        const type = row.dataType.toUpperCase() as ColumnDataType;
        const column: Column = {
            type: type,
            name: row.columnName,
            dataType: row.dataType.toUpperCase(),
            columnType: row.columnType,
            tsType: MYSQL_TYPE_TO_TS_TYPE.get(type),
            isNullable: row.isNullable.toUpperCase().indexOf("YES") >= 0,
            default: this.parseDefault(row.columnDefault),
            columnKey: this.parseColumnKey(row.columnKey),
            extra: row.extra,
            comment: row.columnComment
        };
        if (type === ColumnDataType.MEDIUMTEXT || type === ColumnDataType.TEXT || type === ColumnDataType.LONGTEXT) {
            const res: ColumnText = {
                ...column,
                type: type,
                characterSetName: row.characterSetName,
                collationName: row.collationName
            }
            return res;

        } else if (type === ColumnDataType.CHAR || type === ColumnDataType.VARCHAR) {
            const res: ColumnChar = {
                ...column,
                type: type,
                characterSetName: row.characterSetName,
                collationName: row.collationName,
                characterMaximumLength: row.characterMaxLength,
                characterOctetLength: row.characterOctetLength
            }
            return res;

        } else if (type === ColumnDataType.TINYINT || type === ColumnDataType.SMALLINT || type === ColumnDataType.INT || type === ColumnDataType.MEDIUMINT
            || type === ColumnDataType.BIGINT || type === ColumnDataType.DECIMAL || type === ColumnDataType.FLOAT || type === ColumnDataType.BIT) {
            const typeNum = Number(row.columnType.split("(").pop().split(")").shift());
            const res: ColumnNumber = {
                ...column,
                type: type,
                typeNum: isNaN(typeNum) ? undefined : typeNum,
                scale: row.numericScale,
                precision: row.numericPos,
                isUnsigned: row.columnType.toUpperCase().indexOf("UNSIGNED") >= 0,
                isAutoIncrement: row.extra.toUpperCase().indexOf("AUTO_INCREMENT") >= 0
            }
            return res;

        } else if (type === ColumnDataType.ENUM) {
            const res: ColumnEnum = {
                ...column,
                type: type,
                values: row.columnType.match(/'([^']+)'/g).map(e => e.replace(/'/g, "").replace(/"/g, ""))
            }
            return res;
        } else if (type === ColumnDataType.SET) {
            const res: ColumnSet = {
                ...column,
                type: type,
                values: row.columnType.match(/'([^']+)'/g).map(e => e.replace(/'/g, "").replace(/"/g, ""))
            }
            return res;
        } else {
            return column as AnyColumn;
        }
    }

    private static parseDefault(def: string): string | number {
        if (!def || def === "NULL") {
            return null;
        } else if (!isNaN(Number(def))) {
            return def;
        } else {
            return String(def).split("'").join("");
        }
    }

    private static parseColumnKey(columnKey: string): KeyType[] {
        return columnKey.split(",").map((e) => {
            const key = e.toUpperCase();
            if (key === "PRI") {
                return KeyType.PRIMARY
            } else if (key === "UNI") {
                return KeyType.UNIQUE
            } else if (key === "MUL") {
                return KeyType.MULTIPLE
            } else {
                return null;
            }
        }).filter(e => e);
    }
}

export interface TableStructure {
    name: string;
    columns: AnyColumn[];
}

export enum ColumnDataType {
    TINYINT = "TINYINT",
    SMALLINT = "SMALLINT",
    MEDIUMINT = "MEDIUMINT",
    INT = "INT",
    BIGINT = "BIGINT",
    DECIMAL = "DECIMAL",
    FLOAT = "FLOAT",
    CHAR = "CHAR",
    VARCHAR = "VARCHAR",
    MEDIUMTEXT = "MEDIUMTEXT",
    TEXT = "TEXT",
    LONGTEXT = "LONGTEXT",
    TIMESTAMP = "TIMESTAMP",
    DATETIME = "DATETIME",
    DATE = "DATE",
    TIME = "TIME",
    YEAR = "YEAR",
    ENUM = "ENUM",
    SET = "SET",
    BIT = "BIT",
    LONGBLOB = "LONGBLOB",
    JSON = "JSON"
}

const MYSQL_TYPE_TO_TS_TYPE: Map<ColumnDataType, string> = new Map([
    [ColumnDataType.TINYINT, "number"],
    [ColumnDataType.SMALLINT, "number"],
    [ColumnDataType.MEDIUMINT, "number"],
    [ColumnDataType.INT, "number"],
    [ColumnDataType.BIGINT, "number"],
    [ColumnDataType.DECIMAL, "number"],
    [ColumnDataType.FLOAT, "number"],
    [ColumnDataType.CHAR, "string"],
    [ColumnDataType.VARCHAR, "string"],
    [ColumnDataType.MEDIUMTEXT, "string"],
    [ColumnDataType.TEXT, "string"],
    [ColumnDataType.LONGTEXT, "string"],
    [ColumnDataType.TIMESTAMP, "string"],
    [ColumnDataType.DATETIME, "string"],
    [ColumnDataType.DATE, "string"],
    [ColumnDataType.TIME, "number"],
    [ColumnDataType.YEAR, "number"],
    [ColumnDataType.ENUM, "string"],
    [ColumnDataType.SET, "string"],
    [ColumnDataType.BIT, "number"],
    [ColumnDataType.LONGBLOB, "string"],
    [ColumnDataType.JSON, "string"]
])


export type AnyColumn = ColumnText | ColumnChar | ColumnNumber | ColumnSet | ColumnEnum | ColumnDateTimeLike

export interface Column {
    type: ColumnDataType;
    name: string;
    tsType: string;
    dataType: string // Type like INT
    columnType: string; // Type like INT(11)
    typeNum?: number | undefined // for INT(11), this would be 11
    default: string | number;
    isNullable: boolean;
    columnKey: KeyType[];
    extra: string;
    comment: string;
}

export interface ColumnDateTimeLike extends Column {
    type: ColumnDataType.DATE |
        ColumnDataType.DATETIME |
        ColumnDataType.TIMESTAMP |
        ColumnDataType.YEAR
}

export interface ColumnText extends Column {
    type: ColumnDataType.CHAR |
        ColumnDataType.VARCHAR |
        ColumnDataType.MEDIUMTEXT |
        ColumnDataType.TEXT |
        ColumnDataType.LONGTEXT;
    characterSetName: string;
    collationName: string;
}

export interface ColumnChar extends ColumnText {
    type: ColumnDataType.VARCHAR |
        ColumnDataType.CHAR;
    characterMaximumLength: number;
    characterOctetLength: number;
}

export interface ColumnNumber extends Column {
    type:
        ColumnDataType.TINYINT |
        ColumnDataType.SMALLINT |
        ColumnDataType.MEDIUMINT |
        ColumnDataType.INT |
        ColumnDataType.BIGINT |
        ColumnDataType.DECIMAL |
        ColumnDataType.FLOAT |
        ColumnDataType.BIT
    isUnsigned: boolean;
    isAutoIncrement: boolean;
    precision: number;
    scale: number;
}

export interface ColumnEnum extends Column {
    type: ColumnDataType.ENUM;
    values: string[];
}

export interface ColumnSet extends Column {
    type: ColumnDataType.SET;
    values: string[];
}

export enum KeyType {
    PRIMARY = "primary",
    UNIQUE = "unique",
    MULTIPLE = "multiple"
}

interface SchemaRow {
    tableSchema: string;
    tableName: string;
    columnName: string;
    ordinalPosition: number;
    columnDefault: string;
    isNullable: string;
    dataType: string;
    characterMaxLength: number;
    characterOctetLength: number;
    numericPos: number;
    numericScale: number;
    dateTimePrecision: number;
    characterSetName: string;
    collationName: string;
    columnType: string;
    columnKey: string;
    extra: string;
    columnComment: string;
    isGenerated: string;
    generationExpression: string;
}
