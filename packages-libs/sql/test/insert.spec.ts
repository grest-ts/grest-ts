import {MyDb} from "./tables/MyDb";
import {SQL} from "../src/SQL";
import {tUserId} from "./tables/User";
import {tDateTime} from "@grest-ts/schema";

test("update", async () => {

    const input: { userId: tUserId } = {userId: 10 as tUserId}

    const c = MyDb.user.as("c")
    const c2 = MyDb.user.as("c2")
    String(c2);

    const insertableRow = {
        username: "",
        age: 0,
        isMan: 20,
        uuid: "",
        tin: 1,
        created: "" as tDateTime
    };

    MyDb.user.insert(insertableRow);
    MyDb.user.insert({
        username: "",
        age: 0,
    });

    const q1 = SQL.insertInto(c).set(insertableRow)
    console.log(q1.toSqlString())

    const q2 = SQL.insertInto(c).values([insertableRow, insertableRow])
    console.log(q2.toSqlString())

    const q3 = SQL.insertIgnoreInto(c).select(SQL
        .selectFrom(c)
        .columns(c.username, c.age, c.isMan, c.uuid, c.tin, c.created)
        .where(c.id.eq(input.userId))
        .as("sub")
    )
    console.log(q3.toSqlString())
});
