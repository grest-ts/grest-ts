import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {SQL} from "../src/SQL";
import {MAX} from "../src";

test("update", async () => {


    const input: { userId: tUserId } = {userId: 10 as tUserId}

    const c = MyDb.user.as("c")
    const c2 = MyDb.user.as("c2")
    const s = MyDb.company.as("s")
    String(c2);
    String(s)

    // --------------------

    const q1 = MyDb.user
        .update({
            username: "",
            age: 2
        })
        .where({
            id: input.userId
        })
        .orderBy("id")
        .noLimit()
    console.log(q1.toSqlString());

    // --------------------

    const q2 = SQL.update(c)
        .set({
            username: "username2"
        })
        .where(c.id.eq(input.userId))
        .orderBy(c.id)
        .limit(10)
    console.log(q2.toSqlString());

    // --------------------

    const sub = SQL
        .uses(c)
        .selectFrom(s)
        .columns(s.age)
        .where(s.name.eq(c.username))
        .noLimit()
        .as("sub")

    const q3 = SQL
        .update(c)
        .join(sub)
        .set({
            tin: MAX(c.age),
            age: MAX(sub.age),
            username: "username2",
            //isMan: MAX(c2.age), // __ERROR: c2 not referenced
            //age3: 12,  // __ERROR: age3 does not exist
            //uuid: 12, // __ERROR: wrong type
        })
        .where(
            c.id.eq(input.userId),
            sub.age.eq(10),
            //c2.id.eq(input.userId) // __ERROR: c2 not referenced
        )
        .orderBy(
            c.id,
            sub.age,
            //c2.id // __ERROR: c2 not referenced
        )
        .limit(10)
    console.log(q3.toSqlString());


});


























