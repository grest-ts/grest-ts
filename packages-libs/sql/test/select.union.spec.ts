import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {SQL} from "../src/SQL";
import {execOne} from "./tables/exec";

test("with", async () => {

    const input: { userId: tUserId } = {userId: 10 as tUserId}

    const c = MyDb.user.as("c")

    const q1 = SQL.selectFrom(c).columns(c.username, c.id).where(c.id.eq(input.userId)).noLimit()


    // const q2Mis = SQL.selectFrom(c).columns(c.id).where(c.id.eq(input.userId)).noLimit()
    // const union1 = q1
    //     .unionAll(q2Mis) // ___ERROR Missing column 'username' on added union table!


    // const q2Extra = SQL.selectFrom(c).columns(c.age, c.username, c.id.cast<number>()).where(c.id.eq(input.userId)).noLimit()
    // const union2 = q1
    //     .unionAll(q2Extra) // __ERROR Column "age" does not exist in previous queries!


    const q2 = SQL.selectFrom(c).columns(c.username, c.id.cast<number>()).where(c.id.eq(input.userId)).noLimit()
    const q3 = SQL.selectFrom(c).columns(c.username, c.id).where(c.id.eq(input.userId)).noLimit()
    const union = q1
        .unionAll(q2)
        .unionAll(q3)
        .groupByF(r => [r.username])
        .orderByF(r => [r.id])
        .limit(10)
        .as("x")

    const b = SQL.selectFrom(union)
        .columns(union.id, union.username)
        .where(union.id.eq(10 as tUserId))
        .noLimit()

    console.log(b.toString())

    const res = await execOne(b);
    console.log(
        res.id,  // type tUserId
    )

});
