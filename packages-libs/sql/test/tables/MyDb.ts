import {User, UserRowForEdit} from "./User";
import {Company, CompanyForEdit} from "./Company";
import {MysqlTable} from "../../src/MysqlTable";
import {ColumnDataType} from "../../src";

export class MyDb {

    public static user = new MysqlTable<"user", User, UserRowForEdit>("user", {
        id: {type: ColumnDataType.INT},
        username: {type: ColumnDataType.VARCHAR},
        age: {type: ColumnDataType.INT},
        isMan: {type: ColumnDataType.INT},
        created: {type: ColumnDataType.TIMESTAMP},
        updated_at: {type: ColumnDataType.TIMESTAMP},
        tin: {type: ColumnDataType.INT},
        created_at: {type: ColumnDataType.TIMESTAMP},
        uuid: {type: ColumnDataType.INT},
    })

    public static company = new MysqlTable<"company", Company, CompanyForEdit>("company", {
        id: {type: ColumnDataType.INT},
        name: {type: ColumnDataType.VARCHAR},
        age: {type: ColumnDataType.INT},
    })

}
